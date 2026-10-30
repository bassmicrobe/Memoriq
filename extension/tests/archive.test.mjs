import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveCandidates, restoreArchive, validateArchive, exportBookmarks } from '../archive.mjs';
import { DEFAULT_SETTINGS } from '../policy.mjs';

const now = 1_800_000_000_000;
const tab = { id: 7, title: 'Reading', url: 'https://example.com/', lastAccessed: now - 3_600_000, active: false, pinned: false, audible: false, autoDiscardable: true, discarded: false, status: 'complete' };
const descriptor = { id: tab.id, url: tab.url, lastAccessed: tab.lastAccessed };

function fixture() {
  let stored = [];
  let tabs = [tab];
  let events = [];
  const api = {
    getArchive: async () => stored,
    saveArchive: async (entries) => { stored = entries; events = [...events, 'save']; },
    getSettings: async () => ({ ...DEFAULT_SETTINGS, allowedHosts: ['example.com'] }),
    getTab: async (id) => { const value = tabs.find((value) => value.id === id); if (!value) throw new Error('Missing'); return value; },
    listTabs: async () => tabs,
    closeTab: async (id) => { assert.equal(stored.some((entry) => entry.tabId === id), true); events = [...events, 'close']; tabs = tabs.filter((value) => value.id !== id); },
    createTab: async (url) => { const value = { ...tab, id: 9, url }; tabs = [...tabs, value]; return value; },
    checkPage: async () => null, now: () => now,
    uuid: () => 'local-archive-1',
  };
  return { api, stored: () => stored, tabs: () => tabs, events: () => events };
}

test('archive persists a recovery record before closing, then restores the original URL', async () => {
  const f = fixture();
  const result = await archiveCandidates([descriptor], f.api);
  assert.equal(result.archived.length, 1);
  assert.deepEqual(f.events().slice(0, 2), ['save', 'close']);
  assert.equal(f.tabs().length, 0);
  assert.equal(f.stored()[0].url, tab.url);
  const restored = await restoreArchive(f.api);
  assert.equal(restored.restoredCount, 1);
  assert.equal(f.tabs()[0].url, tab.url);
  assert.deepEqual(f.stored(), []);
});

test('storage failure, dirty input and fresh activation cannot close a tab', async () => {
  for (const changed of [
    { saveArchive: async () => { throw new Error('Storage full'); } },
    { checkPage: async () => 'form-input' },
    { getTab: async () => ({ ...tab, active: true }) },
  ]) {
    const f = fixture();
    const result = await archiveCandidates([descriptor], { ...f.api, ...changed });
    assert.equal(result.archived.length, 0);
    assert.equal(f.tabs().length, 1);
  }
});

test('failed closes or restores retain saved URLs, and restoring an existing tab makes no duplicate', async () => {
  const f = fixture();
  const result = await archiveCandidates([descriptor], { ...f.api, closeTab: async () => { throw new Error('Cannot close'); } });
  assert.equal(result.archived.length, 0);
  assert.equal(f.stored().length, 1);
  await restoreArchive(f.api);
  assert.equal(f.tabs().length, 1);
  assert.deepEqual(f.stored(), []);
  await archiveCandidates([descriptor], f.api);
  await assert.rejects(restoreArchive({ ...f.api, createTab: async () => { throw new Error('Cannot open'); } }));
  assert.equal(f.stored()[0].url, tab.url);
});

test('corrupt local records are rejected before navigating or altering storage', () => {
  for (const url of ['javascript:alert(1)', 'file:///private/x', 'https://user:password@example.com/']) {
    assert.throws(() => validateArchive([{ id: 'x', tabId: 1, title: 'x', url, savedAt: now }]));
  }
  assert.throws(() => validateArchive({}));
});

test('bookmark export escapes titles and preserves safe original URLs', () => {
  const output = exportBookmarks([{ id: 'x', tabId: 1, title: '<script>alert("x")</script>', url: 'https://example.com/?a=1&b=2', savedAt: now }]);
  assert.equal(output.includes('<script>'), false);
  assert.equal(output.includes('&lt;script&gt;'), true);
  assert.equal(output.includes('a=1&amp;b=2'), true);
});

test('a user can choose a saved entry, and a failed storage cleanup never loses the recovery URL', async () => {
  const f = fixture();
  await archiveCandidates([descriptor], f.api);
  await assert.rejects(restoreArchive(f.api, 'unknown'));
  assert.equal(f.stored().length, 1);
  let writes = 0;
  await assert.rejects(restoreArchive({ ...f.api, saveArchive: async (entries) => {
    writes += 1;
    if (writes === 2) throw new Error('Write failed');
    await f.api.saveArchive(entries);
  } }, 'local-archive-1'));
  assert.equal(f.stored()[0].url, tab.url);
  await restoreArchive(f.api, 'local-archive-1');
  assert.equal(f.tabs().length, 1);
  assert.equal(f.stored().length, 0);
});

test('activation after the backup write rolls it back and leaves the original tab open', async () => {
  const f = fixture();
  let reads = 0;
  const result = await archiveCandidates([descriptor], { ...f.api, getTab: async () => {
    reads += 1;
    return { ...tab, active: reads === 3 };
  } });
  assert.equal(result.skipped[0].reason, 'active');
  assert.equal(f.tabs().length, 1);
  assert.deepEqual(f.stored(), []);
});
