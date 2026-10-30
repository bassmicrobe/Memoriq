import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, rm, access, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { runBulkProbe } from './bulk-probe.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.env.CHROMIUM_EXECUTABLE_PATH;
assert.ok(executable, 'Set CHROMIUM_EXECUTABLE_PATH to an isolated Chrome for Testing executable');
await access(executable);
const extension = join(root, 'extension');
const id = (await readFile(join(extension, 'extension-id.txt'), 'utf8')).trim();
const appPath = process.env.APP_PATH ?? join(root, 'dist', 'Memoriq.app');
const binary = join(appPath, 'Contents', 'MacOS', 'MemoryHarbor');
await access(binary);
const bulk = process.env.BULK_PROBE === '1';
const results = join(root, 'test-results', bulk ? (process.env.BULK_ACTION === 'archive' ? 'bulk-archive-probe' : 'bulk-probe') : 'browser-discard-probe');
await mkdir(results, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'memoriq-raw-cdp-'));
const launchExtension = bulk ? join(profile, 'test-extension') : extension;
if (bulk) {
  await cp(extension, launchExtension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(launchExtension, 'manifest.json'), 'utf8'));
  await writeFile(join(launchExtension, 'manifest.json'), JSON.stringify({ ...manifest, host_permissions: ['http://*/*', 'https://*/*'] }));
}
let observation = { startedAt: new Date().toISOString(), checks: [], status: 'running', clockShiftMs: 360_000, note: '隔離プロファイル。CDPは拡張ページとworkerだけに接続し、休止対象には接続しません。workerの時計を6分進めてcontrollerとUIを通した休止・復帰を検証します。実時間5分の候補化は先行テストで確認しています。' };
let browser;
let ws;
let server;
let stderr = '';
let requests = 0;
let pending = {};
let sequence = 0;

async function record(name, data = {}) {
  observation = { ...observation, checks: [...observation.checks, { name, at: new Date().toISOString(), ...data }] };
  await writeFile(join(results, 'result.json'), `${JSON.stringify(observation, null, 2)}\n`);
  console.log(JSON.stringify({ stage: name, ...data }));
}

async function send(method, params = {}, sessionId) {
  const messageId = ++sequence;
  return new Promise((resolveMessage, rejectMessage) => {
    const timeout = setTimeout(() => rejectMessage(new Error(`CDP timeout: ${method}`)), 20_000);
    pending = { ...pending, [messageId]: { resolve: resolveMessage, reject: rejectMessage, timeout } };
    ws.send(JSON.stringify({ id: messageId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

async function evaluate(sessionId, fn, args = null, userGesture = false) {
  const response = await send('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true, userGesture }, sessionId);
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result.value;
}

async function until(sessionId, fn, args = null) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await evaluate(sessionId, fn, args);
    if (result) return result;
    await delay(100);
  }
  throw new Error('Timed out waiting for the extension UI');
}

async function screenshot(sessionId, filename) {
  const height = await evaluate(sessionId, () => Math.ceil(document.body.getBoundingClientRect().height));
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 400, height, scale: 1 } }, sessionId);
  await writeFile(join(results, filename), Buffer.from(result.data, 'base64'));
}

try {
  await mkdir(join(profile, 'NativeMessagingHosts'));
  await writeFile(join(profile, 'NativeMessagingHosts', 'jp.local.memoryharbor.json'), JSON.stringify({ name: 'jp.local.memoryharbor', description: 'Memoriq isolated probe', path: binary, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] }));
  server = createServer((request, response) => {
    if (!request.url.startsWith('/fixture')) { response.writeHead(404); response.end(); return; }
    requests += 1;
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    const isDraft = request.url.includes('draft');
    response.end(`<!doctype html><title>Memoriq isolated ${isDraft ? 'draft' : 'fixture'}</title><link rel="icon" href="data:,"><h1>Memoriq test page</h1>${isDraft ? '<textarea id="draft"></textarea><script>document.querySelector("textarea").value="Keep this draft";</script>' : `<script>window.fixture = new Uint8Array(${bulk ? 64 : 32} * 1024 * 1024); ${bulk ? 'const words=new Uint32Array(window.fixture.buffer);let seed=(Math.random()*4294967295)>>>0;for(let i=0;i<words.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;words[i]=seed;}' : 'window.fixture.fill(13);'}</script>`}`);
  });
  await new Promise((resolveListen, rejectListen) => { server.once('error', rejectListen); server.listen(0, '127.0.0.1', resolveListen); });
  const url = `http://localhost:${server.address().port}/fixture`;
  browser = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--disable-extensions-except=${launchExtension}`, `--load-extension=${launchExtension}`, ...(bulk ? ['--host-resolver-rules=MAP *.test 127.0.0.1'] : []), '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--password-store=basic', '--use-mock-keychain', '--disable-background-networking', '--disable-sync', '--disable-component-update', '--disable-search-engine-choice-screen', ...(process.env.SMOKE_HEADED === '1' ? [] : ['--headless=new']), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  browser.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-2_000_000); });
  browser.on('error', (error) => { stderr = `${stderr}\nBrowser process error: ${error.message}`; });
  let endpoint;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n'); endpoint = `ws://127.0.0.1:${port}${path}`; break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; await delay(100); }
  }
  assert.ok(endpoint, 'Chrome did not expose its localhost CDP endpoint');
  ws = new WebSocket(endpoint);
  await new Promise((resolveOpen, rejectOpen) => { ws.addEventListener('open', resolveOpen, { once: true }); ws.addEventListener('error', rejectOpen, { once: true }); });
  ws.addEventListener('message', (event) => {
    const response = JSON.parse(event.data);
    const handler = pending[response.id];
    if (!handler) return;
    const { [response.id]: removed, ...remaining } = pending;
    pending = remaining;
    clearTimeout(handler.timeout);
    if (response.error) handler.reject(new Error(`${response.error.message}`));
    else handler.resolve(response.result);
  });
  ws.addEventListener('close', () => {
    for (const handler of Object.values(pending)) { clearTimeout(handler.timeout); handler.reject(new Error('Browser CDP disconnected')); }
    pending = {};
  });
  const version = await send('Browser.getVersion');
  await record('browser-started', { product: version.product });
  const target = await send('Target.createTarget', { url: `chrome-extension://${id}/popup.html` });
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate(sessionId, () => typeof chrome !== 'undefined' && Boolean(chrome.tabs))) break;
    await delay(100);
  }
  if (bulk) {
    await runBulkProbe({ evaluate, until, sessionId, url, record, send, executable });
  } else {
  const tab = await evaluate(sessionId, (fixtureUrl) => chrome.tabs.create({ url: fixtureUrl, active: false }), url);
  let state;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    state = await evaluate(sessionId, (tabId) => chrome.tabs.get(tabId), tab.id);
    if (state.status === 'complete' && requests > 0) break;
    await delay(100);
  }
  assert.equal(state.active, false);
  const targets = await send('Target.getTargets');
  const fixtureTarget = targets.targetInfos.find((item) => item.url === url);
  assert.ok(fixtureTarget);
  assert.equal(fixtureTarget.attached, false);
  await record('fixture-debugger-not-attached', { tabId: tab.id, attached: fixtureTarget.attached, active: state.active });

  const saved = await evaluate(sessionId, () => chrome.runtime.sendMessage({ action: 'save-settings', settings: { automatic: false, minimumIdleMinutes: 5, allowedHosts: ['localhost'], excludedHosts: [] } }));
  assert.equal(saved.ok, true, saved.error);
  await record('settings-saved', { settings: saved.data.settings });
  const targetList = await send('Target.getTargets');
  const workerTarget = targetList.targetInfos.find((item) => item.type === 'service_worker' && item.url === `chrome-extension://${id}/worker.mjs`);
  assert.ok(workerTarget);
  const { sessionId: workerSession } = await send('Target.attachToTarget', { targetId: workerTarget.targetId, flatten: true });
  await evaluate(workerSession, () => { const originalNow = Date.now.bind(Date); Object.defineProperty(Date, 'now', { value: () => originalNow() + 360_000 }); });
  await record('worker-test-clock-injected', { milliseconds: 360_000 });
  await evaluate(sessionId, (tabId) => chrome.tabs.update(tabId, { pinned: true }), tab.id);
  const pinnedPreview = await evaluate(sessionId, () => chrome.runtime.sendMessage({ action: 'preview' }));
  assert.equal(pinnedPreview.ok, true);
  assert.deepEqual(pinnedPreview.data.candidates, []);
  await evaluate(sessionId, (tabId) => chrome.tabs.update(tabId, { pinned: false }), tab.id);
  const popupTab = await evaluate(sessionId, () => chrome.tabs.getCurrent());
  await evaluate(sessionId, (tabId) => chrome.tabs.update(tabId, { active: true }), tab.id);
  const activePreview = await evaluate(sessionId, () => chrome.runtime.sendMessage({ action: 'preview' }));
  assert.equal(activePreview.ok, true);
  assert.deepEqual(activePreview.data.candidates, []);
  await evaluate(sessionId, (tabId) => chrome.tabs.update(tabId, { active: true }), popupTab.id);
  await record('active-and-pinned-protection-through-controller');
  await until(sessionId, () => Boolean(document.querySelector('#refresh')) && !document.querySelector('#refresh').disabled);
  await evaluate(sessionId, () => document.querySelector('#refresh').click());
  await until(sessionId, (tabId) => Boolean(document.querySelector(`#candidate-${tabId}`)), tab.id);
  const preview = await evaluate(sessionId, () => chrome.runtime.sendMessage({ action: 'preview' }));
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.data.candidates.map((value) => value.id), [tab.id]);
  await evaluate(sessionId, () => document.querySelector('#snapshot').click());
  await until(sessionId, () => document.querySelector('#native-data')?.textContent.includes('物理メモリ'));
  await screenshot(sessionId, 'popup-candidate.png');
  await record('candidate-rendered-in-popup');
  const before = await evaluate(sessionId, () => chrome.runtime.sendMessage({ action: 'snapshot' }));
  assert.equal(before.ok, true, before.error);
  const requestsBefore = requests;
  const immediatelyBefore = await send('Target.getTargets');
  assert.equal(immediatelyBefore.targetInfos.find((item) => item.url === url).attached, false);
  await evaluate(sessionId, () => document.querySelector('#discard').click());
  await until(sessionId, () => document.querySelector('#status')?.textContent.includes('1件を休止しました'));
  const confirmed = await evaluate(sessionId, (tabId) => chrome.tabs.get(tabId), tab.id);
  assert.equal(confirmed.discarded, true);
  assert.equal(requests, requestsBefore);
  await screenshot(sessionId, 'popup-after.png');
  await record('controller-discard-confirmed', { tabId: tab.id });
  await delay(1000);
  const after = await evaluate(sessionId, () => chrome.runtime.sendMessage({ action: 'snapshot' }));
  assert.equal(after.ok, true, after.error);
  const app = (response) => response.data.apps.find((value) => value.bundlePath.includes('Google Chrome for Testing.app'));
  if (app(before) && app(after)) await record('footprint-measured', { beforeBytes: app(before).footprintBytes, afterBytes: app(after).footprintBytes, differenceBytes: app(before).footprintBytes - app(after).footprintBytes, note: 'テスト用Chrome全体の一時的な差分。共有ページと他の処理の変動を含みます。' });
  await evaluate(sessionId, (tabId) => chrome.tabs.update(tabId, { active: true }), tab.id);
  for (let attempt = 0; attempt < 100 && requests <= requestsBefore; attempt += 1) await delay(100);
  assert.ok(requests > requestsBefore);
  const restored = await evaluate(sessionId, (tabId) => chrome.tabs.get(tabId), tab.id);
  assert.equal(restored.discarded, false);
  await record('restored-with-new-request', { requestsBefore, requestsAfter: requests });
  }
  observation = { ...observation, status: 'passed' };
  await record('completed');
} catch (error) {
  observation = { ...observation, status: 'failed', failure: error instanceof Error ? error.stack : String(error) };
  await record('failed', { message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  ws?.close();
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    browser.kill('SIGTERM');
    await Promise.race([new Promise((resolveExit) => browser.once('exit', resolveExit)), delay(5000)]);
    if (browser.exitCode === null && browser.signalCode === null) browser.kill('SIGKILL');
  }
  if (server) await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  await writeFile(join(results, 'browser.log'), stderr);
  observation = { ...observation, exitCode: browser?.exitCode, signal: browser?.signalCode, cleanedUpAt: new Date().toISOString() };
  await writeFile(join(results, 'result.json'), `${JSON.stringify(observation, null, 2)}\n`);
  await rm(profile, { recursive: true, force: true });
}
