import { evaluateTab, MAX_BATCH_SIZE, validateSettings } from './policy.mjs';

const MAX_ARCHIVE_SIZE = 500;
export function validateArchive(value) {
  if (!Array.isArray(value) || value.length > MAX_ARCHIVE_SIZE) throw new Error('退避データを読み取れません。拡張を削除せず、データを確認してください。');
  const entries = value.map((entry) => {
    const url = new URL(entry?.url);
    if (!entry || Object.keys(entry).some((key) => !['id', 'tabId', 'url', 'title', 'savedAt'].includes(key)) ||
        typeof entry.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(entry.id) || !Number.isSafeInteger(entry.tabId) || entry.tabId < 0 ||
        typeof entry.url !== 'string' || entry.url.length > 8192 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        typeof entry.title !== 'string' || entry.title.length > 200 || !Number.isSafeInteger(entry.savedAt) || entry.savedAt < 0) throw new Error('退避データの形式が正しくありません。');
    return { id: entry.id, tabId: entry.tabId, url: entry.url, title: entry.title, savedAt: entry.savedAt };
  });
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error('退避データが重複しています。');
  return entries;
}

function decision(tab, expected, settings, now, options) {
  if (tab.url !== expected.url || tab.lastAccessed !== expected.lastAccessed) return 'changed';
  return evaluateTab(tab, settings, now, options).reason;
}

export async function archiveCandidates(candidates, api, options = {}) {
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > MAX_BATCH_SIZE) throw new Error('退避候補が上限を超えています。');
  return candidates.reduce(async (pending, expected) => {
    const result = await pending;
    try {
      const settings = validateSettings(await api.getSettings());
      const tab = await api.getTab(expected.id);
      const reason = decision(tab, expected, settings, api.now(), options) ?? await api.checkPage(tab);
      if (reason !== null) return { ...result, skipped: [...result.skipped, { id: expected.id, reason }] };
      const fresh = await api.getTab(expected.id);
      const freshSettings = validateSettings(await api.getSettings());
      const latestReason = decision(fresh, expected, freshSettings, api.now(), options);
      if (latestReason !== null) return { ...result, skipped: [...result.skipped, { id: expected.id, reason: latestReason }] };
      const previous = validateArchive(await api.getArchive());
      const existing = previous.find((entry) => entry.tabId === tab.id && entry.url === tab.url);
      const entry = existing ?? { id: api.uuid(), tabId: tab.id, url: tab.url, title: typeof tab.title === 'string' ? tab.title.slice(0, 200) : '', savedAt: api.now() };
      const saved = validateArchive(existing ? previous : [...previous, entry]);
      await api.saveArchive(saved);
      const finalTab = await api.getTab(expected.id);
      const finalReason = decision(finalTab, expected, validateSettings(await api.getSettings()), api.now(), options);
      if (finalReason !== null) {
        await api.saveArchive(previous);
        return { ...result, skipped: [...result.skipped, { id: expected.id, reason: finalReason }] };
      }
      await api.closeTab(expected.id);
      const closed = !(await api.listTabs()).some((tab) => tab.id === expected.id);
      if (!closed) return { ...result, skipped: [...result.skipped, { id: expected.id, reason: 'not-confirmed' }] };
      return { ...result, archived: [...result.archived, entry.id] };
    } catch (error) {
      console.error('Memoriq: archive operation failed; saved recovery records are retained', { tabId: expected.id, message: error instanceof Error ? error.message : 'Unknown error' });
      return { ...result, failed: [...result.failed, { id: expected.id, reason: '退避を完了できませんでした。保存済みの復元情報は保持しています。' }] };
    }
  }, Promise.resolve({ archived: [], skipped: [], failed: [] }));
}

export async function restoreArchive(api, entryId) {
  const entries = validateArchive(await api.getArchive());
  if (entries.length === 0) return { restoredCount: 0 };
  const entry = entryId === undefined ? entries[0] : entries.find((value) => value.id === entryId);
  if (!entry) throw new Error('退避したタブが見つかりません。一覧を更新してください。');
  const existing = (await api.listTabs()).find((tab) => tab.url === entry.url);
  if (!existing) {
    const created = await api.createTab(entry.url);
    if (!Number.isSafeInteger(created?.id) || (created.url !== entry.url && created.pendingUrl !== entry.url)) throw new Error('タブの復元を確認できません。退避データは保持しています。');
    // Save the new ID first, so a failed subsequent write cannot create duplicates.
    await api.saveArchive(entries.map((value) => value.id === entry.id ? { ...value, tabId: created.id } : value));
  }
  await api.saveArchive(entries.filter((value) => value.id !== entry.id));
  return { restoredCount: 1 };
}

export function exportBookmarks(archive) {
  const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const links = validateArchive(archive).map((entry) => `<DT><A HREF="${escape(entry.url)}">${escape(entry.title || entry.url)}</A>`);
  return ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Memoriq Tabs</TITLE>', '<H1>Memoriq Tabs</H1>', '<DL><p>', ...links, '</DL><p>'].join('\n');
}
