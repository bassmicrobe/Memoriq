import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extension = join(root, 'extension');
const extensionId = (await readFile(join(extension, 'extension-id.txt'), 'utf8')).trim();
const appPath = process.env.APP_PATH ?? join(root, 'dist', 'Memoriq.app');
const nativeBinary = process.env.MEMORY_HARBOR_APP_BINARY ?? join(appPath, 'Contents', 'MacOS', 'MemoryHarbor');
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH ?? chromium.executablePath();
await Promise.all([access(nativeBinary), access(executablePath)]);
// Playwright attaches CDP to every page. Discard integration runs separately with
// browser-discard-probe.mjs so the target fixture has no debugger attached.
// This opt-in is only for reproducing the observed Chrome for Testing crash.
const uiOnly = process.env.SMOKE_DEBUGGER_DISCARD !== '1';
const clockShiftMs = Number(process.env.SMOKE_CLOCK_SHIFT_MS ?? '0');
const minimalArgs = process.env.SMOKE_MINIMAL_ARGS === '1';
assert.ok(Number.isSafeInteger(clockShiftMs) && clockShiftMs >= 0 && clockShiftMs <= 600_000, 'SMOKE_CLOCK_SHIFT_MS must be 0–600000');
const results = join(root, 'test-results', uiOnly ? 'browser-smoke-ui' : clockShiftMs > 0 ? 'browser-smoke-fast' : 'browser-smoke');
await mkdir(results, { recursive: true });
const userDataDir = await mkdtemp(join(tmpdir(), 'memory-harbor-browser-'));
const extensionUrl = `chrome-extension://${extensionId}`;
let errors = [];
let lifecycle = [];
let observed = { startedAt: new Date().toISOString(), extensionId, clockShiftMs, checks: [], errors, lifecycle, note: '専用一時プロファイルを使用。通常のChrome設定・タブは変更していません。clockShiftMsが0以外の場合のみ、拡張workerの時計をテスト専用に進めています。' };
let context;
let server;
let requestCounts = { idle: 0, active: 0 };

async function record(name, data = {}) {
  observed = { ...observed, errors, lifecycle, checks: [...observed.checks, { name, at: new Date().toISOString(), ...data }] };
  await writeFile(join(results, 'result.json'), `${JSON.stringify(observed, null, 2)}\n`);
  console.log(JSON.stringify({ stage: name, ...data }));
}

async function api(page, action, parameters = {}) {
  const response = await page.evaluate((message) => chrome.runtime.sendMessage(message), { action, ...parameters });
  assert.equal(response.ok, true, response.error ?? `Action failed: ${action}`);
  return response.data;
}

try {
  const manifestDir = join(userDataDir, 'NativeMessagingHosts');
  await mkdir(manifestDir, { recursive: true });
  await writeFile(join(manifestDir, 'jp.local.memoryharbor.json'), JSON.stringify({ name: 'jp.local.memoryharbor', description: 'Memoriq isolated smoke test', path: nativeBinary, type: 'stdio', allowed_origins: [`${extensionUrl}/`] }));

  server = createServer((request, response) => {
    const route = new URL(request.url, 'http://localhost').pathname.slice(1);
    if (!['idle', 'active'].includes(route)) { response.writeHead(404); response.end(); return; }
    requestCounts = { ...requestCounts, [route]: requestCounts[route] + 1 };
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Memoriq test ${route}</title><link rel="icon" href="data:,"></head><body><h1>Memoriq ${route}</h1><p>Isolated test page. 32 MiB memory allocation.</p><script>window.memoryHarborFixture = new Uint8Array(32 * 1024 * 1024); window.memoryHarborFixture.fill(37);</script></body></html>`);
  });
  await new Promise((resolveListen, rejectListen) => { server.once('error', rejectListen); server.listen(0, '127.0.0.1', resolveListen); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://localhost:${address.port}`;

  context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: process.env.SMOKE_HEADED !== '1',
    ignoreDefaultArgs: minimalArgs,
    viewport: { width: 1000, height: 850 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--no-default-browser-check', ...(minimalArgs ? ['--remote-debugging-pipe', `--user-data-dir=${userDataDir}`, '--password-store=basic', '--use-mock-keychain', '--disable-background-networking', '--disable-sync', '--disable-component-update', '--disable-search-engine-choice-screen', ...(process.env.SMOKE_HEADED === '1' ? [] : ['--headless=new'])] : [])],
  });
  observed = { ...observed, browserVersion: context.browser()?.version() ?? 'unknown', headed: process.env.SMOKE_HEADED === '1', minimalArgs };
  context.on('console', (message) => { if (message.type() === 'error') errors = [...errors, { type: 'console', text: message.text() }]; });
  context.on('close', () => { lifecycle = [...lifecycle, { event: 'context-close', at: new Date().toISOString() }]; });
  context.browser()?.on('disconnected', () => { lifecycle = [...lifecycle, { event: 'browser-disconnected', at: new Date().toISOString() }]; });
  context.on('page', (page) => {
    page.on('pageerror', (error) => { errors = [...errors, { type: 'pageerror', text: error.message }]; });
    page.on('close', () => { lifecycle = [...lifecycle, { event: 'page-close', url: page.url(), at: new Date().toISOString() }]; });
    page.on('crash', () => { lifecycle = [...lifecycle, { event: 'page-crash', url: page.url(), at: new Date().toISOString() }]; });
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  worker.on('close', () => { lifecycle = [...lifecycle, { event: 'worker-close', at: new Date().toISOString() }]; });
  assert.equal(new URL(worker.url()).hostname, extensionId);

  const idlePage = await context.newPage();
  await idlePage.goto(`${baseUrl}/idle`);
  const activePage = await context.newPage();
  await activePage.goto(`${baseUrl}/active`);
  await activePage.bringToFront();
  const newPagePromise = context.waitForEvent('page');
  await worker.evaluate((url) => chrome.windows.create({ url, focused: true, type: 'normal' }), `${extensionUrl}/options.html`);
  const optionsPage = await newPagePromise;
  await optionsPage.waitForURL(`${extensionUrl}/options.html`);
  await optionsPage.locator('#fields').waitFor({ state: 'visible' });
  await optionsPage.locator('#allowed').fill('localhost');
  await optionsPage.locator('#idle').fill('5');
  await optionsPage.locator('#automatic').uncheck();
  await optionsPage.locator('#save').click();
  await optionsPage.getByRole('status').filter({ hasText: '保存しました' }).waitFor();
  const settings = await api(optionsPage, 'get-settings');
  assert.deepEqual(settings, { automatic: false, minimumIdleMinutes: 5, allowedHosts: ['localhost'], excludedHosts: [] });
  await optionsPage.screenshot({ path: join(results, 'options.png'), fullPage: true });
  await record('settings-saved-via-ui', { settings });

  for (const width of [320, 390]) {
    await optionsPage.setViewportSize({ width, height: 850 });
    assert.equal(await optionsPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Settings overflow at ${width}px`);
  }
  await optionsPage.screenshot({ path: join(results, 'options-mobile.png'), fullPage: true });
  await optionsPage.locator('#idle').focus();
  await optionsPage.keyboard.press('Tab');
  assert.equal(await optionsPage.locator('#allowed').evaluate((input) => document.activeElement === input && getComputedStyle(input).outlineStyle === 'solid'), true, 'Keyboard focus must remain visible');
  await optionsPage.setViewportSize({ width: 1000, height: 850 });
  await record('responsive-settings-and-keyboard-focus');

  const initial = await api(optionsPage, 'preview');
  assert.equal(initial.candidates.length, 0);
  const tabs = await optionsPage.evaluate(() => chrome.tabs.query({}));
  const idleTab = tabs.find((tab) => tab.url === `${baseUrl}/idle`);
  const activeTab = tabs.find((tab) => tab.url === `${baseUrl}/active`);
  assert.ok(idleTab && activeTab);
  assert.equal(idleTab.active, false);
  assert.equal(activeTab.active, true);
  const nativeBefore = await api(optionsPage, 'snapshot');
  assert.ok(nativeBefore.memory.totalBytes > 0);
  await record('native-snapshot', { memory: nativeBefore.memory, appCount: nativeBefore.apps.length });

  await optionsPage.getByRole('link', { name: 'タブ整理へ' }).click();
  await optionsPage.waitForURL(`${extensionUrl}/popup.html`);
  await optionsPage.locator('#snapshot').click();
  await optionsPage.locator('#native-data').filter({ hasText: '物理メモリ' }).waitFor();
  await optionsPage.locator('body').screenshot({ path: join(results, 'popup-before.png') });

  if (!uiOnly) {
    if (clockShiftMs > 0) {
      await worker.evaluate((shift) => {
        const originalNow = Date.now.bind(Date);
        Object.defineProperty(Date, 'now', { value: () => originalNow() + shift });
      }, clockShiftMs);
      await record('test-clock-injected', { clockShiftMs });
    }
    const readyAt = idleTab.lastAccessed + 5 * 60_000 + 1500;
    await record('waiting-for-real-idle-time', { readyAt: new Date(readyAt).toISOString(), remainingSeconds: Math.ceil((readyAt - Date.now()) / 1000) });
    while (Date.now() + clockShiftMs < readyAt) {
      await delay(Math.min(30_000, readyAt - Date.now()));
      console.log(JSON.stringify({ stage: 'idle-wait', remainingSeconds: Math.max(0, Math.ceil((readyAt - Date.now()) / 1000)) }));
    }

    await optionsPage.evaluate((tabId) => chrome.tabs.update(tabId, { pinned: true }), idleTab.id);
    assert.equal((await api(optionsPage, 'preview')).candidates.length, 0);
    const protectedState = await optionsPage.evaluate((ids) => Promise.all(ids.map((tabId) => chrome.tabs.get(tabId))), [idleTab.id, activeTab.id]);
    assert.equal(protectedState[0].pinned, true);
    assert.equal(protectedState[0].discarded, false);
    assert.equal(protectedState[1].active, true);
    assert.equal(protectedState[1].discarded, false);
    await record('active-and-pinned-protection');
    await optionsPage.evaluate((tabId) => chrome.tabs.update(tabId, { pinned: false }), idleTab.id);
    await delay(1500);
    await optionsPage.locator('#refresh').click();
    await optionsPage.locator(`#candidate-${idleTab.id}`).waitFor();
    const preview = await api(optionsPage, 'preview');
    assert.deepEqual(preview.candidates.map(({ id: tabId }) => tabId), [idleTab.id]);
    await optionsPage.locator('body').screenshot({ path: join(results, 'popup-candidate.png') });
    const nativeImmediatelyBefore = await api(optionsPage, 'snapshot');
    const requestsBefore = requestCounts.idle;
    await optionsPage.locator('#discard').click();
    await optionsPage.getByRole('status').filter({ hasText: '1件を休止しました' }).waitFor();
    const discarded = await optionsPage.evaluate((tabId) => chrome.tabs.get(tabId), idleTab.id);
    assert.equal(discarded.discarded, true);
    assert.equal(requestCounts.idle, requestsBefore);
    await delay(1000);
    const nativeAfter = await api(optionsPage, 'snapshot');
    const testingApp = (snapshot) => snapshot.apps.find((app) => app.bundlePath.includes('Google Chrome for Testing.app'));
    const beforeApp = testingApp(nativeImmediatelyBefore);
    const afterApp = testingApp(nativeAfter);
    await record('discard-confirmed', { tabId: idleTab.id, pageRequests: requestCounts.idle, footprint: beforeApp && afterApp ? { beforeBytes: beforeApp.footprintBytes, afterBytes: afterApp.footprintBytes, differenceBytes: beforeApp.footprintBytes - afterApp.footprintBytes, note: 'Chrome for Testingアプリ全体の差分。共有メモリ・時間経過・他タブの変動を含み、普遍的な削減量ではありません。' } : null });
    await optionsPage.locator('body').screenshot({ path: join(results, 'popup-after.png') });

    await optionsPage.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), idleTab.id);
    const reloadDeadline = Date.now() + 15_000;
    while (requestCounts.idle <= requestsBefore && Date.now() < reloadDeadline) await delay(100);
    assert.ok(requestCounts.idle > requestsBefore);
    const restored = await optionsPage.evaluate((tabId) => chrome.tabs.get(tabId), idleTab.id);
    assert.equal(restored.discarded, false);
    await record('reload-after-reactivation', { requestsBefore, requestsAfter: requestCounts.idle });
  }
  assert.deepEqual(errors, [], 'Browser console or page errors were recorded');
  observed = { ...observed, status: 'passed' };
  await record('completed', { mode: uiOnly ? 'ui-only' : 'full' });
} catch (error) {
  observed = { ...observed, status: 'failed', failure: error instanceof Error ? error.stack : String(error) };
  await record('failed', { message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  if (context) await context.close();
  if (server) await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  await rm(userDataDir, { recursive: true, force: true });
  observed = { ...observed, lifecycle, cleanedUpAt: new Date().toISOString() };
  await writeFile(join(results, 'result.json'), `${JSON.stringify(observed, null, 2)}\n`);
}
