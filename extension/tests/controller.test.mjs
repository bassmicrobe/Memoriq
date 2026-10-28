import test from 'node:test';
import assert from 'node:assert/strict';
import { createController, ALARM_NAME, NATIVE_HOST } from '../controller.mjs';
import { DEFAULT_SETTINGS } from '../policy.mjs';

const now = 1_800_000_000_000;
const id = 'hlpfkbhcceingaddcmcdnajaggkcbfmd';
const sender = { id, url: `chrome-extension://${id}/popup.html` };
const readyTab = { id: 4, url: 'https://example.com/', title: 'Example', active: false, pinned: false, audible: false, discarded: false, autoDiscardable: true, status: 'complete', lastAccessed: now - 3_600_000 };
const configuration = { ...DEFAULT_SETTINGS, allowedHosts: ['example.com'] };
const nativeResponse = { ok: true, data: { timestamp: '2026-10-28T00:00:00Z', memory: { totalBytes: 1024, swapUsedBytes: 0, pressure: 'normal' }, apps: [], unreadableProcessCount: 0 }, error: null };

function fixture(initial = {}) {
  let stored = { ...initial };
  let calls = [];
  let alarm = null;
  let tabs = [readyTab];
  const record = (name, value) => { calls = [...calls, { name, value }]; };
  const api = {
    runtime: { id, getURL: (path) => `chrome-extension://${id}/${path}`, sendNativeMessage: async (host, message) => { record('native', { host, message }); return nativeResponse; } },
    storage: { local: {
      get: async (keys) => { record('read', keys); return stored; },
      set: async (values) => { record('write', values); stored = { ...stored, ...values }; },
    } },
    alarms: {
      get: async () => alarm,
      create: async (name, details) => { record('alarm-create', { name, details }); alarm = { name }; },
      clear: async (name) => { record('alarm-clear', name); alarm = null; return true; },
    },
    tabs: {
      query: async () => tabs,
      get: async (tabId) => { record('tab-get', tabId); const found = tabs.find((tab) => tab.id === tabId); if (!found) throw new Error('Missing tab'); return found; },
      discard: async (tabId) => { record('discard', tabId); tabs = tabs.map((tab) => tab.id === tabId ? { ...tab, discarded: true } : tab); },
    },
  };
  return { api, controller: createController(api, () => now), calls: () => calls, stored: () => stored };
}

test('untrusted sender is rejected before any read or write', async () => {
  for (const untrusted of [undefined, { ...sender, id: 'another' }, { ...sender, url: 'https://example.com/' }, { ...sender, url: `chrome-extension://${id}/unknown.html` }]) {
    const f = fixture();
    await assert.rejects(f.controller.handle({ action: 'save-settings', settings: configuration }, untrusted));
    assert.deepEqual(f.calls(), []);
  }
});

test('initial state has no automatic timer and preview causes no writes or native connection', async () => {
  const f = fixture();
  await f.controller.initialize();
  assert.equal(f.calls().some(({ name }) => name === 'alarm-create'), false);
  const view = await f.controller.handle({ action: 'preview' }, sender);
  assert.deepEqual(view.candidates, []);
  assert.equal(view.settings.automatic, false);
  assert.equal(f.calls().some(({ name }) => ['native', 'write', 'discard'].includes(name)), false);
});

test('invalid saved data fails closed without resetting or discarding tabs', async () => {
  const initial = { settings: { automatic: true } };
  const f = fixture(initial);
  await assert.rejects(f.controller.onAlarm({ name: ALARM_NAME }));
  assert.equal(f.calls().some(({ name }) => ['write', 'discard', 'native'].includes(name)), false);
  assert.deepEqual(f.stored(), initial);
});

test('saving validates before persistence and enabling creates a one-minute timer', async () => {
  const f = fixture();
  await assert.rejects(f.controller.handle({ action: 'save-settings', settings: { ...configuration, allowedHosts: ['*'] } }, sender));
  assert.deepEqual(f.stored(), {});
  const enabled = { ...configuration, automatic: true };
  const result = await f.controller.handle({ action: 'save-settings', settings: enabled }, sender);
  assert.deepEqual(f.stored().settings, enabled);
  assert.equal(result.warning, null);
  assert.deepEqual(f.calls().find(({ name }) => name === 'alarm-create').value.details, { delayInMinutes: 1, periodInMinutes: 1 });
  await f.controller.initialize();
  assert.equal(f.calls().filter(({ name }) => name === 'alarm-create').length, 1);
});

test('alarm only acts on eligible tabs when automatic is enabled, and never reads native data', async () => {
  const off = fixture({ settings: configuration });
  await off.controller.onAlarm({ name: ALARM_NAME });
  assert.equal(off.calls().some(({ name }) => name === 'discard'), false);
  const f = fixture({ settings: { ...configuration, automatic: true } });
  await f.controller.onAlarm({ name: 'unrelated' });
  assert.deepEqual(f.calls(), []);
  await f.controller.onAlarm({ name: ALARM_NAME });
  assert.equal(f.calls().filter(({ name }) => name === 'discard').length, 1);
  assert.equal(f.calls().some(({ name }) => name === 'native'), false);
  assert.equal(f.stored().lastRun.discardedCount, 1);
  assert.equal(f.stored().lastRun.automatic, true);
  assert.equal(JSON.stringify(f.stored().lastRun).includes('example.com'), false);
});

test('manual preview has no side effect and discard reports verified persisted outcome', async () => {
  const f = fixture({ settings: configuration });
  const preview = await f.controller.handle({ action: 'preview' }, sender);
  assert.equal(preview.candidates.length, 1);
  assert.equal(f.calls().some(({ name }) => ['write', 'discard'].includes(name)), false);
  const candidates = preview.candidates.map(({ id: tabId, url, lastAccessed }) => ({ id: tabId, url, lastAccessed }));
  const result = await f.controller.handle({ action: 'discard', candidates }, sender);
  assert.deepEqual(result.discarded, [4]);
  const updated = await f.controller.handle({ action: 'preview' }, sender);
  assert.equal(updated.discardedTabs, 1);
  assert.deepEqual(updated.candidates, []);
});

test('preview explains why tabs are protected without exposing their URLs or changing them', async () => {
  const f = fixture({ settings: configuration });
  const api = { ...f.api, tabs: { ...f.api.tabs, query: async () => [
    { ...readyTab, autoDiscardable: false },
    { ...readyTab, id: 5, title: 'Recent', lastAccessed: now - 60_000 },
    { ...readyTab, id: 6 },
  ] } };
  const view = await createController(api, () => now).handle({ action: 'preview' }, sender);
  assert.deepEqual(view.blockedTabs, [
    { id: 4, title: 'Example', reason: 'protected' },
    { id: 5, title: 'Recent', reason: 'recent' },
  ]);
  assert.equal(view.candidates.length, 1);
  assert.equal(f.calls().some(({ name }) => ['write', 'discard', 'native'].includes(name)), false);
});

test('manual inclusion travels through validated preview and discard but is never persisted', async () => {
  const f = fixture({ settings: configuration });
  let discarded = false;
  const api = { ...f.api, tabs: {
    query: async () => [{ ...readyTab, autoDiscardable: false, discarded }],
    get: async () => ({ ...readyTab, autoDiscardable: false, discarded }),
    discard: async () => { discarded = true; },
  } };
  const controller = createController(api, () => now);
  assert.equal((await controller.handle({ action: 'preview' }, sender)).candidates.length, 0);
  const view = await controller.handle({ action: 'preview', allowProtected: true }, sender);
  assert.equal(view.candidates.length, 1);
  const candidates = view.candidates.map(({ id: tabId, url, lastAccessed }) => ({ id: tabId, url, lastAccessed }));
  await assert.rejects(controller.handle({ action: 'discard', candidates, allowProtected: 'yes' }, sender));
  assert.equal(discarded, false);
  const result = await controller.handle({ action: 'discard', candidates, allowProtected: true }, sender);
  assert.deepEqual(result.discarded, [4]);
  assert.deepEqual(f.stored().settings, configuration);
  assert.equal('allowProtected' in f.stored(), false);
});

test('native snapshot is explicit, schema-checked and uses the fixed read-only protocol', async () => {
  const f = fixture();
  const data = await f.controller.handle({ action: 'snapshot' }, sender);
  assert.deepEqual(data, nativeResponse.data);
  assert.deepEqual(f.calls(), [{ name: 'native', value: { host: NATIVE_HOST, message: { version: 1, action: 'snapshot' } } }]);
  const badApi = { ...f.api, runtime: { ...f.api.runtime, sendNativeMessage: async () => ({ ok: true, data: { wrong: true } }) } };
  await assert.rejects(createController(badApi).handle({ action: 'snapshot' }, sender), /タブの休止は拡張単体で使えます/);
  const missingApi = { ...f.api, runtime: { ...f.api.runtime, sendNativeMessage: async () => { throw new Error('Host not installed'); } } };
  const missing = createController(missingApi);
  await assert.rejects(missing.handle({ action: 'snapshot' }, sender), /タブの休止は拡張単体で使えます/);
  assert.equal((await missing.handle({ action: 'preview' }, sender)).totalTabs, 1);
});

test('alarm installation failure is surfaced without pretending settings failed to save', async () => {
  const f = fixture();
  const api = { ...f.api, alarms: { ...f.api.alarms, create: async () => { throw new Error('Alarm unavailable'); } } };
  const result = await createController(api).handle({ action: 'save-settings', settings: { ...configuration, automatic: true } }, sender);
  assert.match(result.warning, /設定は保存されました/);
  assert.equal(f.stored().settings.automatic, true);
  assert.equal(f.stored().lastError, result.warning);
});
