import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { median } from '../extension/measurement.mjs';

export async function runBulkProbe({ evaluate, until, sessionId, url, record, send, executable }) {
  const count = 6;
  const archive = process.env.BULK_ACTION === 'archive';
  const tabs = await evaluate(sessionId, async ({ url, count }) => {
    const result = [];
    for (let index = 0; index < count; index += 1) {
      const fixture = new URL(url);
      fixture.hostname = `memoriq${index}.test`;
      result.push(await chrome.tabs.create({ url: `${fixture.href}?i=${index}`, active: false }));
    }
    const draft = await chrome.tabs.create({ url: `${url}?draft`, active: false });
    return { ids: result.map((tab) => tab.id), draftId: draft.id };
  }, { url, count });
  await until(sessionId, async ({ ids, draftId }) => (await chrome.tabs.query({})).filter((tab) => [...ids, draftId].includes(tab.id)).every((tab) => tab.status === 'complete'), tabs);
  const targets = await send('Target.getTargets');
  const fixtureTarget = (target) => /^http:\/\/memoriq\d+\.test:/.test(target.url) || target.url.startsWith(url);
  assert.equal(targets.targetInfos.filter(fixtureTarget).some((target) => target.attached), false);
  const allocations = await evaluate(sessionId, async (ids) => Promise.all(ids.map(async (id) => {
    const frames = await chrome.scripting.executeScript({ target: { tabId: id }, world: 'MAIN', func: () => window.fixture?.byteLength });
    return frames[0].result;
  })), tabs.ids);
  assert.deepEqual(allocations, Array(count).fill(64 * 1024 ** 2));
  await evaluate(sessionId, (id) => chrome.tabs.update(id, { autoDiscardable: false }), tabs.ids[0]);
  await record('bulk-fixtures-loaded', { count, allocatedBytes: count * 64 * 1024 ** 2, draftTab: true, note: 'Synthetic pages allocate 64 MiB of random data each to avoid trivial compression. Test manifest pregrants host access only in the temporary profile.' });
  const saved = await evaluate(sessionId, () => chrome.runtime.sendMessage({ action: 'save-settings', settings: { automatic: false, minimumIdleMinutes: 30, allowedHosts: [], excludedHosts: [] } }));
  assert.equal(saved.ok, true, saved.error);
  const regular = await evaluate(sessionId, () => chrome.runtime.sendMessage({ action: 'preview' }));
  assert.equal(regular.data.candidates.length, 0);
  await until(sessionId, () => Boolean(document.querySelector('#sweep')) && !document.querySelector('#sweep').disabled);
  await evaluate(sessionId, () => document.querySelector('#sweep').click(), null, true);
  await until(sessionId, () => document.querySelector('#sweep').getAttribute('aria-pressed') === 'true' && !document.querySelector('#sweep').disabled);
  assert.equal(await evaluate(sessionId, () => document.querySelector('#manual-protected').checked), true);
  const preview = await evaluate(sessionId, () => chrome.runtime.sendMessage({ action: 'preview', sweep: true, allowProtected: true }));
  assert.equal(preview.ok, true, preview.error);
  assert.deepEqual(preview.data.candidates.map((tab) => tab.id).toSorted(), tabs.ids.toSorted());
  assert.equal(preview.data.blockedTabs.find((tab) => tab.id === tabs.draftId)?.reason, 'form-input');
  assert.equal(await evaluate(sessionId, () => document.querySelectorAll('.candidate input:checked').length), 0);
  await record('sweep-preview-protects-draft', { eligible: preview.data.candidates.length, draftReason: 'form-input', preselected: 0 });

  const bundlePath = executable.slice(0, executable.indexOf('.app/') + 4);
  const sample = async () => {
    let samples = [];
    let processCounts = [];
    for (let index = 0; index < 5; index += 1) {
      const snapshot = await evaluate(sessionId, () => chrome.runtime.sendMessage({ action: 'snapshot' }));
      assert.equal(snapshot.ok, true, snapshot.error);
      const app = snapshot.data.apps.find((app) => app.bundlePath === bundlePath);
      assert.ok(app, `No native measurement for ${bundlePath}`);
      samples = [...samples, app.footprintBytes];
      processCounts = [...processCounts, app.processCount];
      await delay(500);
    }
    await record('native-samples', { processCounts, samples });
    return samples;
  };
  const before = await sample();
  const processesBefore = await send('SystemInfo.getProcessInfo');
  await evaluate(sessionId, (archive) => { document.querySelector('#select-all').click(); document.querySelector(archive ? '#archive' : '#discard').click(); }, archive, true);
  await until(sessionId, (archive) => document.querySelector('#status').textContent.includes(archive ? '6件を退避しました' : '6件を休止しました'), archive);
  const current = await evaluate(sessionId, () => chrome.tabs.query({}));
  const sleeping = current.filter((tab) => /^http:\/\/memoriq\d+\.test:/.test(tab.url));
  assert.equal(sleeping.length, archive ? 0 : count);
  if (!archive) assert.equal(sleeping.every((tab) => tab.discarded), true);
  if (archive) {
    const saved = await evaluate(sessionId, () => chrome.runtime.sendMessage({ action: 'get-archive' }));
    assert.equal(saved.ok, true, saved.error);
    assert.equal(saved.data.length, count);
  }
  assert.equal(current.find((tab) => tab.id === tabs.draftId).discarded, false);
  await until(sessionId, () => !document.querySelector('#sweep').disabled);
  await delay(10_000);
  const processesAfter = await send('SystemInfo.getProcessInfo');
  await record('browser-process-lifecycle', { renderersBefore: processesBefore.processInfo.filter((process) => process.type === 'renderer').length, renderersAfter: processesAfter.processInfo.filter((process) => process.type === 'renderer').length, settleSeconds: 10 });
  const after = await sample();
  const beforeBytes = median(before);
  const afterBytes = median(after);
  await record('bulk-discard-and-measurement', { action: archive ? 'archive' : 'discard', completedCount: count, beforeSamples: before, afterSamples: after, beforeBytes, afterBytes, differenceBytes: beforeBytes - afterBytes, percent: (beforeBytes - afterBytes) / beforeBytes * 100, note: 'Five native phys_footprint samples per side, same browser bundle. Synthetic fixture result, not a prediction for normal browsing.' });
  if (archive) {
    await evaluate(sessionId, () => document.querySelector('#restore').click());
    await until(sessionId, () => document.querySelector('#status').textContent.includes('1枚をバックグラウンドに戻しました'));
    const saved = await evaluate(sessionId, () => chrome.runtime.sendMessage({ action: 'get-archive' }));
    assert.equal(saved.data.length, count - 1);
  }
  const restored = archive ? (await evaluate(sessionId, () => chrome.tabs.query({}))).find((tab) => /^http:\/\/memoriq\d+\.test:/.test(tab.url)) : sleeping[0];
  assert.ok(restored);
  await evaluate(sessionId, (id) => chrome.tabs.update(id, { active: true }), restored.id);
  await until(sessionId, async (id) => { const tab = await chrome.tabs.get(id); return !tab.discarded && tab.status === 'complete'; }, restored.id);
  // A second sweep must still protect the dirty document after other tabs unload.
  const verifiedDraft = await evaluate(sessionId, async (id) => {
    const frames = await chrome.scripting.executeScript({ target: { tabId: id }, func: () => document.querySelector('#draft').value });
    return frames[0].result;
  }, tabs.draftId);
  assert.equal(verifiedDraft, 'Keep this draft');
  await record('bulk-restored-and-draft-preserved', { restored: true, draftPreserved: true });
}
