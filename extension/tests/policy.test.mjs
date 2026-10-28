import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, validateSettings, evaluateTab, selectCandidates, validateSnapshot, validateRequest } from '../policy.mjs';
import { discardCandidates } from '../operations.mjs';

const now = 1_800_000_000_000;
const settings = { ...DEFAULT_SETTINGS, allowedHosts: ['example.com'] };
const tab = (changes = {}) => ({ id: 7, url: 'https://example.com/read', active: false, pinned: false, audible: false, discarded: false, autoDiscardable: true, status: 'complete', lastAccessed: now - 3_600_000, ...changes });

test('initial settings cannot discard or automatically act on any site', () => {
  assert.equal(DEFAULT_SETTINGS.automatic, false);
  assert.deepEqual(DEFAULT_SETTINGS.allowedHosts, []);
  assert.equal(evaluateTab(tab(), DEFAULT_SETTINGS, now).eligible, false);
});

test('only an explicitly allowed, idle tab is eligible; exact hosts do not include subdomains', () => {
  assert.equal(evaluateTab(tab(), settings, now).eligible, true);
  assert.equal(evaluateTab(tab({ url: 'https://sub.example.com/' }), settings, now).reason, 'not-allowed');
  assert.equal(evaluateTab(tab({ url: 'https://example.com.evil.test/' }), settings, now).reason, 'not-allowed');
  assert.equal(evaluateTab(tab(), { ...settings, excludedHosts: ['example.com'] }, now).reason, 'excluded');
});

test('active, selected, fixed, audible, loading and non-auto-discardable tabs are protected', () => {
  for (const change of [{ active: true }, { highlighted: true }, { pinned: true }, { audible: true }, { status: 'loading' }, { autoDiscardable: false }, { discarded: true }, { incognito: true }]) {
    assert.equal(evaluateTab(tab(change), settings, now).eligible, false, JSON.stringify(change));
  }
});

test('unknown, future or recent access time, unsupported URLs and incomplete data are protected', () => {
  for (const change of [{ lastAccessed: undefined }, { lastAccessed: NaN }, { lastAccessed: now + 1 }, { lastAccessed: now - 100 }, { url: 'file:///test' }, { url: 'chrome://settings' }, { url: 'not a URL' }, { active: undefined }, { autoDiscardable: undefined }, { id: undefined }, { pendingUrl: 'https://example.com/new' }]) {
    assert.equal(evaluateTab(tab(change), settings, now).eligible, false, JSON.stringify(change));
  }
});

test('settings are validated, normalized and never mutate the caller', () => {
  const input = { ...settings, allowedHosts: [' EXAMPLE.COM ', 'example.com'] };
  const copy = structuredClone(input);
  assert.deepEqual(validateSettings(input).allowedHosts, ['example.com']);
  assert.deepEqual(input, copy);
  for (const invalid of [{ ...settings, minimumIdleMinutes: 0 }, { ...settings, automatic: 'yes' }, { ...settings, allowedHosts: ['https://example.com'] }, { ...settings, allowedHosts: ['*.example.com'] }, { ...settings, excludedHosts: 'example.com' }, { ...settings, unexpected: true }]) {
    assert.throws(() => validateSettings(invalid));
  }
});

test('candidate order is oldest first, bounded to three, without reordering input', () => {
  const input = [1, 2, 3, 4].map((id) => tab({ id, lastAccessed: now - id * 3_600_000 }));
  assert.deepEqual(selectCandidates(input, settings, now).map(({ id }) => id), [4, 3, 2]);
  assert.deepEqual(input.map(({ id }) => id), [1, 2, 3, 4]);
});

test('explicit manual inclusion relaxes only known automatic-discard protection', () => {
  const manual = { allowProtected: true };
  assert.equal(evaluateTab(tab({ autoDiscardable: false }), settings, now, manual).eligible, true);
  assert.equal(selectCandidates([tab({ autoDiscardable: false })], settings, now, manual).length, 1);
  for (const change of [{ active: true }, { audible: true }, { pinned: true }, { highlighted: true }, { autoDiscardable: undefined }, { lastAccessed: now }, { url: 'https://other.test/' }, { incognito: true }]) {
    assert.equal(evaluateTab(tab({ autoDiscardable: false, ...change }), settings, now, manual).eligible, false);
  }
  assert.deepEqual(validateRequest({ action: 'preview', allowProtected: true }), { action: 'preview', allowProtected: true });
  assert.throws(() => validateRequest({ action: 'preview', allowProtected: 'yes' }));
  assert.throws(() => validateRequest({ action: 'snapshot', allowProtected: true }));
});

test('manual protection inclusion cannot be used by automatic work', async () => {
  for (const automatic of [false, true]) {
    let discarded = false;
    const protectedTab = tab({ autoDiscardable: false });
    const result = await discardCandidates([{ id: 7, url: protectedTab.url, lastAccessed: protectedTab.lastAccessed }], {
      getSettings: async () => ({ ...settings, automatic: true }),
      getTab: async () => ({ ...protectedTab, discarded }),
      discardTab: async () => { discarded = true; }, now: () => now,
    }, { automatic, allowProtected: true });
    assert.equal(result.discarded.length, automatic ? 0 : 1);
    assert.equal(discarded, !automatic);
  }
});

test('message boundary rejects excessive IDs and unknown actions', () => {
  assert.deepEqual(validateRequest({ action: 'preview' }), { action: 'preview' });
  assert.throws(() => validateRequest({ action: 'discard', candidates: [1, 2, 3, 4] }));
  assert.throws(() => validateRequest({ action: 'terminate', pid: 3 }));
  assert.throws(() => validateRequest({ action: 'snapshot', extra: true }));
  assert.throws(() => validateRequest({ action: 'save-settings', settings: { automatic: true } }));
});

const snapshot = () => ({ ok: true, data: { timestamp: '2026-10-28T00:00:00Z', memory: { totalBytes: 32 * 1024 ** 3, swapUsedBytes: 1024, pressure: 'normal' }, apps: [{ id: 'test', name: 'Test', bundlePath: '/Applications/Test.app', footprintBytes: 1024, processCount: 2, protected: true }], unreadableProcessCount: 0 }, error: null });

test('native snapshot validates shape, numeric limits, identifiers, and pressure', () => {
  assert.equal(validateSnapshot(snapshot()).apps[0].name, 'Test');
  for (const invalid of [null, { ok: false, error: 'secret error' }, { ...snapshot(), data: { ...snapshot().data, timestamp: 'bad' } }, { ...snapshot(), data: { ...snapshot().data, memory: { totalBytes: -1, swapUsedBytes: 0, pressure: 'normal' } } }, { ...snapshot(), data: { ...snapshot().data, memory: { totalBytes: 1, swapUsedBytes: 0, pressure: 'great' } } }, { ...snapshot(), data: { ...snapshot().data, apps: [{ ...snapshot().data.apps[0], footprintBytes: NaN }] } }]) {
    assert.throws(() => validateSnapshot(invalid));
  }
});

test('recheck prevents discard after activation, navigation, access, or settings change', async () => {
  for (const current of [tab({ active: true }), tab({ url: 'https://example.com/other' }), tab({ lastAccessed: now - 2_000_000 })]) {
    const calls = [];
    const result = await discardCandidates([{ id: 7, url: tab().url, lastAccessed: tab().lastAccessed }], { getSettings: async () => settings, getTab: async () => current, discardTab: async (id) => calls.push(id), now: () => now });
    assert.deepEqual(calls, []);
    assert.equal(result.discarded.length, 0);
    assert.equal(result.skipped.length, 1);
  }
  const calls = [];
  await discardCandidates([{ id: 7, url: tab().url, lastAccessed: tab().lastAccessed }], { getSettings: async () => DEFAULT_SETTINGS, getTab: async () => tab(), discardTab: async (id) => calls.push(id), now: () => now });
  assert.deepEqual(calls, []);
});

test('discard uses fresh state, runs sequentially, and confirms actual discarded state', async () => {
  const events = [];
  const discarded = new Set();
  const candidates = [1, 2].map((id) => ({ id, url: tab().url, lastAccessed: tab().lastAccessed }));
  const result = await discardCandidates(candidates, { getSettings: async () => settings, getTab: async (id) => { events.push(`get:${id}`); return tab({ id, discarded: discarded.has(id) }); }, discardTab: async (id) => { events.push(`discard:${id}`); discarded.add(id); }, now: () => now });
  assert.deepEqual(events, ['get:1', 'discard:1', 'get:1', 'get:2', 'discard:2', 'get:2']);
  assert.deepEqual(result.discarded, [1, 2]);
});

test('discard verifies the returned replacement tab ID instead of looking up the removed ID', async () => {
  let calls = [];
  const result = await discardCandidates([{ id: 7, url: tab().url, lastAccessed: tab().lastAccessed }], {
    getSettings: async () => settings,
    getTab: async (id) => {
      calls = [...calls, id];
      if (id === 7 && calls.length === 1) return tab();
      if (id === 9) return tab({ id: 9, discarded: true });
      throw new Error('No tab with id');
    },
    discardTab: async () => tab({ id: 9, discarded: true }), now: () => now,
  });
  assert.deepEqual(calls, [7, 9]);
  assert.deepEqual(result.discarded, [9]);
  assert.deepEqual(result.failed, []);
});

test('a replacement tab with a different URL is not reported as a confirmed discard', async () => {
  const result = await discardCandidates([{ id: 7, url: tab().url, lastAccessed: tab().lastAccessed }], {
    getSettings: async () => settings, getTab: async () => tab(),
    discardTab: async () => tab({ id: 9, discarded: true, url: 'https://other.test/' }), now: () => now,
  });
  assert.deepEqual(result.discarded, []);
  assert.equal(result.skipped.length, 1);
});

test('API failures are reported and do not fabricate successful memory savings', async () => {
  const result = await discardCandidates([{ id: 7, url: tab().url, lastAccessed: tab().lastAccessed }], { getSettings: async () => settings, getTab: async () => tab(), discardTab: async () => { throw new Error('failure'); }, now: () => now });
  assert.deepEqual(result.discarded, []);
  assert.equal(result.failed.length, 1);
});

test('automatic work stops if it was disabled after preview', async () => {
  const calls = [];
  const result = await discardCandidates([{ id: 7, url: tab().url, lastAccessed: tab().lastAccessed }], { getSettings: async () => settings, getTab: async () => tab(), discardTab: async (id) => calls.push(id), now: () => now }, { automatic: true });
  assert.deepEqual(calls, []);
  assert.equal(result.skipped.length, 1);
});
