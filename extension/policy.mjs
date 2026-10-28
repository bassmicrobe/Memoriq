export const MAX_BATCH_SIZE = 3;
export const DEFAULT_SETTINGS = Object.freeze({
  automatic: false,
  minimumIdleMinutes: 30,
  allowedHosts: Object.freeze([]),
  excludedHosts: Object.freeze([]),
});

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const text = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit;

function knownKeys(value, keys) {
  if (!record(value) || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error('設定または操作の形式が正しくありません。');
  }
}

function hosts(value) {
  if (!Array.isArray(value) || value.length > 200) throw new Error('サイト一覧は200件以内で指定してください。');
  const normalized = value.map((host) => {
    if (typeof host !== 'string') throw new Error('サイトにはホスト名を入力してください。');
    const result = host.trim().toLowerCase();
    if (!text(result, 253) || !result.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
      throw new Error('ホスト名だけを入力してください。URL・パス・ワイルドカードは使えません。');
    }
    return result;
  });
  return [...new Set(normalized)];
}

export function validateSettings(value) {
  knownKeys(value, ['automatic', 'minimumIdleMinutes', 'allowedHosts', 'excludedHosts']);
  if (typeof value.automatic !== 'boolean') throw new Error('自動休止の設定が正しくありません。');
  if (!integer(value.minimumIdleMinutes, 5, 1440)) throw new Error('未使用時間は5〜1440分の整数で指定してください。');
  return {
    automatic: value.automatic,
    minimumIdleMinutes: value.minimumIdleMinutes,
    allowedHosts: hosts(value.allowedHosts),
    excludedHosts: hosts(value.excludedHosts),
  };
}

function webUrl(value) {
  if (!text(value, 8192)) return null;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed : null;
  } catch {
    return null;
  }
}

export function evaluateTab(tab, settings, now) {
  const deny = (reason) => ({ eligible: false, reason });
  if (!record(tab) || !integer(tab.id)) return deny('unknown');
  if (tab.active !== false || tab.highlighted === true) return deny('active');
  if (tab.pinned !== false) return deny('pinned');
  if (tab.audible === true) return deny('audible');
  if (tab.discarded !== false) return deny('discarded');
  if (tab.autoDiscardable !== true) return deny('protected');
  if (tab.status !== 'complete' || tab.pendingUrl) return deny('loading');
  if (tab.incognito === true) return deny('incognito');
  const url = webUrl(tab.url);
  if (!url) return deny('unsupported-url');
  if (settings.excludedHosts.includes(url.hostname)) return deny('excluded');
  if (!settings.allowedHosts.includes(url.hostname)) return deny('not-allowed');
  if (!Number.isFinite(tab.lastAccessed) || tab.lastAccessed < 0 || tab.lastAccessed > now) return deny('unknown-access');
  const idleMinutes = (now - tab.lastAccessed) / 60_000;
  if (idleMinutes < settings.minimumIdleMinutes) return deny('recent');
  return { eligible: true, reason: null, idleMinutes, hostname: url.hostname };
}

export function selectCandidates(tabs, settings, now) {
  if (!Array.isArray(tabs)) throw new Error('タブ一覧を取得できませんでした。');
  return tabs
    .map((tab) => ({ tab, decision: evaluateTab(tab, settings, now) }))
    .filter(({ decision }) => decision.eligible)
    .toSorted((a, b) => a.tab.lastAccessed - b.tab.lastAccessed)
    .slice(0, MAX_BATCH_SIZE)
    .map(({ tab, decision }) => ({ id: tab.id, url: tab.url, lastAccessed: tab.lastAccessed, title: typeof tab.title === 'string' ? tab.title.slice(0, 200) : decision.hostname, hostname: decision.hostname, idleMinutes: Math.floor(decision.idleMinutes) }));
}

function candidate(value) {
  knownKeys(value, ['id', 'url', 'lastAccessed']);
  if (!integer(value.id) || !webUrl(value.url) || !Number.isFinite(value.lastAccessed) || value.lastAccessed < 0) {
    throw new Error('休止候補が正しくありません。一覧を更新してください。');
  }
  return { id: value.id, url: value.url, lastAccessed: value.lastAccessed };
}

export function validateRequest(value) {
  if (!record(value)) throw new Error('操作の形式が正しくありません。');
  if (['preview', 'get-settings', 'snapshot'].includes(value.action)) {
    knownKeys(value, ['action']);
    return { action: value.action };
  }
  if (value.action === 'save-settings') {
    knownKeys(value, ['action', 'settings']);
    return { action: value.action, settings: validateSettings(value.settings) };
  }
  if (value.action === 'discard') {
    knownKeys(value, ['action', 'candidates']);
    if (!Array.isArray(value.candidates) || value.candidates.length < 1 || value.candidates.length > MAX_BATCH_SIZE) throw new Error('一度に休止できるのは1〜3件です。');
    const candidates = value.candidates.map(candidate);
    if (new Set(candidates.map(({ id }) => id)).size !== candidates.length) throw new Error('休止候補が重複しています。');
    return { action: value.action, candidates };
  }
  throw new Error('この操作には対応していません。');
}

export function validateSnapshot(response) {
  const invalid = () => { throw new Error('Macアプリから正しい計測結果を受信できませんでした。'); };
  if (!record(response) || response.ok !== true || response.error !== null || !record(response.data)) return invalid();
  const { timestamp, memory, apps, unreadableProcessCount } = response.data;
  if (!text(timestamp, 100) || !Number.isFinite(Date.parse(timestamp)) || !record(memory)) return invalid();
  if (!integer(memory.totalBytes, 1) || !integer(memory.swapUsedBytes) || !['normal', 'warning', 'critical', 'unknown'].includes(memory.pressure)) return invalid();
  if (!Array.isArray(apps) || apps.length > 500 || !integer(unreadableProcessCount)) return invalid();
  const normalizedApps = apps.map((app) => {
    if (!record(app) || !text(app.id, 512) || !text(app.name, 256) || !text(app.bundlePath, 4096) || !app.bundlePath.startsWith('/') || !integer(app.footprintBytes) || !integer(app.processCount, 0, 100_000) || typeof app.protected !== 'boolean') return invalid();
    return { id: app.id, name: app.name, bundlePath: app.bundlePath, footprintBytes: app.footprintBytes, processCount: app.processCount, protected: app.protected };
  });
  return { timestamp, memory: { totalBytes: memory.totalBytes, swapUsedBytes: memory.swapUsedBytes, pressure: memory.pressure }, apps: normalizedApps, unreadableProcessCount };
}
