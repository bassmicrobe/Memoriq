import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DEFAULT_SETTINGS, evaluateTab, selectCandidates, validateRequest, validateSettings } from '../policy.mjs';
import { discardCandidates } from '../operations.mjs';
import { inspectPage, checkPageSafety } from '../page-safety.mjs';

const now = 1_800_000_000_000;
const tab = (changes = {}) => ({ id: 1, url: 'https://reading.test/', lastAccessed: now - 60_000, active: false, pinned: false, audible: false, discarded: false, autoDiscardable: true, status: 'complete', ...changes });
const descriptor = (value) => ({ id: value.id, url: value.url, lastAccessed: value.lastAccessed });

test('sweep includes recent non-allowlisted tabs, still protects work and exclusions', () => {
  assert.equal(evaluateTab(tab(), DEFAULT_SETTINGS, now, { sweep: true }).eligible, true);
  assert.equal(evaluateTab(tab({ autoDiscardable: false }), DEFAULT_SETTINGS, now, { sweep: true }).eligible, false);
  assert.equal(evaluateTab(tab({ autoDiscardable: false }), DEFAULT_SETTINGS, now, { sweep: true, allowProtected: true }).eligible, true);
  for (const changes of [{ active: true }, { highlighted: true }, { pinned: true }, { audible: true }, { incognito: true }, { lastAccessed: undefined }, { url: 'https://meet.google.com/abc' }, { url: 'https://docs.google.com/document/d/x' }]) {
    assert.equal(evaluateTab(tab(changes), DEFAULT_SETTINGS, now, { sweep: true }).eligible, false);
  }
  assert.equal(evaluateTab(tab(), { ...DEFAULT_SETTINGS, excludedHosts: ['reading.test'] }, now, { sweep: true }).reason, 'excluded');
  assert.equal(validateRequest({ action: 'preview', sweep: true }).sweep, true);
  assert.throws(() => validateRequest({ action: 'preview', sweep: 'yes' }));
  assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS, allSites: 'yes' }));
  assert.equal(validateSettings({ automatic: false, minimumIdleMinutes: 30, allowedHosts: [], excludedHosts: [] }).allSites, false);
});

test('bulk selection and requests accept 50 tabs, reject 51, and retain oldest-first ordering', () => {
  const input = Array.from({ length: 60 }, (_, i) => tab({ id: i, lastAccessed: now - (i + 1) * 60_000 }));
  const selected = selectCandidates(input, DEFAULT_SETTINGS, now, { sweep: true });
  assert.equal(selected.length, 50);
  assert.equal(selected[0].id, 59);
  assert.equal(validateRequest({ action: 'discard', sweep: true, candidates: selected.map(descriptor) }).candidates.length, 50);
  assert.throws(() => validateRequest({ action: 'discard', sweep: true, candidates: input.slice(0, 51).map(descriptor) }));
});

test('sweep fails closed on dirty, unavailable and timed out page checks; no discard occurs', async () => {
  for (const reason of ['form-input', 'page-unverified', 'media']) {
    let discarded = false;
    const result = await discardCandidates([descriptor(tab())], { getSettings: async () => DEFAULT_SETTINGS, getTab: async () => tab(), now: () => now, checkPage: async () => reason, discardTab: async () => { discarded = true; } }, { sweep: true });
    assert.equal(discarded, false);
    assert.equal(result.skipped[0].reason, reason);
  }
});

test('activation while inspecting the page prevents discard, even in sweep mode', async () => {
  let reads = 0;
  let discarded = false;
  const result = await discardCandidates([descriptor(tab())], { getSettings: async () => DEFAULT_SETTINGS, getTab: async () => { reads += 1; return tab({ active: reads > 1 }); }, now: () => now, checkPage: async () => null, discardTab: async () => { discarded = true; } }, { sweep: true });
  assert.equal(discarded, false);
  assert.equal(result.skipped.length, 1);
});

test('sweep override cannot leak into automatic execution', async () => {
  let discarded = false;
  const result = await discardCandidates([descriptor(tab())], { getSettings: async () => ({ ...DEFAULT_SETTINGS, automatic: true }), getTab: async () => tab(), now: () => now, checkPage: async () => null, discardTab: async () => { discarded = true; } }, { automatic: true, sweep: true });
  assert.equal(discarded, false);
  assert.equal(result.skipped.length, 1);
});

test('page checks reject missing permission, frame gaps, navigation and injection errors', async () => {
  const clean = { frameId: 0, result: { reason: null, url: tab().url, childFrames: 0 } };
  for (const response of [[], [{ ...clean, result: { ...clean.result, childFrames: 1 } }], [{ ...clean, result: { ...clean.result, url: 'https://other.test/' } }], [{ frameId: 0, result: null }]]) {
    assert.equal(await checkPageSafety({ scripting: { executeScript: async () => response }, permissions: { contains: async () => true } }, tab()), 'page-unverified');
  }
  assert.equal(await checkPageSafety({ scripting: { executeScript: async () => [clean] }, permissions: { contains: async () => true } }, tab()), null);
  assert.equal(await checkPageSafety({ permissions: { contains: async () => false } }, tab()), 'page-unverified');
  assert.equal(await checkPageSafety({ scripting: { executeScript: async () => { throw new Error('Denied'); } }, permissions: { contains: async () => true } }, tab()), 'page-unverified');
});

test('adapted OSS form check detects text, toggle, select, file, editor and playing media', () => {
  const run = (fields = [], media = []) => vm.runInNewContext(`(${inspectPage.toString()})()`, {
    location: { href: tab().url },
    document: { pictureInPictureElement: null, querySelectorAll: (selector) => selector === 'iframe, frame' ? [] : selector === 'audio, video' ? media : fields },
  });
  assert.equal(run().reason, null);
  for (const field of [
    { tagName: 'INPUT', type: 'text', value: 'draft', defaultValue: '' },
    { tagName: 'INPUT', type: 'checkbox', checked: true, defaultChecked: false },
    { tagName: 'SELECT', options: [{ selected: true, defaultSelected: false }] },
    { tagName: 'INPUT', type: 'file', files: [1] },
    { isContentEditable: true, textContent: 'Draft' },
  ]) assert.equal(run([field]).reason, 'form-input');
  assert.equal(run([], [{ paused: false, ended: false }]).reason, 'media');
});
