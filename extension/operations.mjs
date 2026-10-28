import { evaluateTab, MAX_BATCH_SIZE, validateSettings } from './policy.mjs';

export async function discardCandidates(candidates, api, { automatic = false, allowProtected = false } = {}) {
  if (!Array.isArray(candidates) || candidates.length > MAX_BATCH_SIZE) throw new Error('休止候補が上限を超えています。');
  return candidates.reduce(async (pending, expected) => {
    const result = await pending;
    try {
      const settings = validateSettings(await api.getSettings());
      const tab = await api.getTab(expected.id);
      const changed = tab.url !== expected.url || tab.lastAccessed !== expected.lastAccessed;
      const decision = evaluateTab(tab, settings, api.now(), { allowProtected: !automatic && allowProtected });
      if ((automatic && !settings.automatic) || changed || !decision.eligible) {
        return { ...result, skipped: [...result.skipped, { id: expected.id, reason: changed ? 'changed' : decision.reason ?? 'automatic-disabled' }] };
      }
      const response = await api.discardTab(expected.id);
      const target = response === undefined ? { id: expected.id } : response;
      const validId = Number.isSafeInteger(target?.id) && target.id >= 0;
      const validReplacement = target?.id === expected.id || (target?.url === expected.url && target?.discarded === true);
      if (!validId || !validReplacement) return { ...result, skipped: [...result.skipped, { id: expected.id, reason: 'not-confirmed' }] };
      const confirmed = await api.getTab(target.id);
      if (confirmed?.id !== target.id || confirmed.url !== expected.url || confirmed.discarded !== true) return { ...result, skipped: [...result.skipped, { id: expected.id, reason: 'not-confirmed' }] };
      return { ...result, discarded: [...result.discarded, target.id] };
    } catch (error) {
      console.error('Memoriq: tab discard failed', { tabId: expected.id, message: error instanceof Error ? error.message : 'Unknown failure' });
      return { ...result, failed: [...result.failed, { id: expected.id, reason: '操作を完了できませんでした。タブが閉じられたか、Chromeが操作を拒否した可能性があります。' }] };
    }
  }, Promise.resolve({ discarded: [], skipped: [], failed: [] }));
}
