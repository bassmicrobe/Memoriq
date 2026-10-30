import { DEFAULT_SETTINGS, evaluateTab, selectCandidates, validateRequest, validateSettings, validateSnapshot } from './policy.mjs';
import { discardCandidates } from './operations.mjs';
import { checkPageSafety } from './page-safety.mjs';
import { archiveCandidates, restoreArchive, validateArchive } from './archive.mjs';

export const ALARM_NAME = 'memory-harbor-idle-check';
export const NATIVE_HOST = 'jp.local.memoryharbor';

export function createController(api, now = () => Date.now()) {
  let actionQueue = Promise.resolve();
  const archiveApi = {
    getArchive: async () => validateArchive((await api.storage.local.get('archive')).archive ?? []),
    saveArchive: (archive) => api.storage.local.set({ archive }),
    getSettings: settings,
    getTab: (id) => api.tabs.get(id),
    listTabs: () => api.tabs.query({}),
    closeTab: (id) => api.tabs.remove(id),
    createTab: (url) => api.tabs.create({ url, active: false }),
    checkPage: (tab) => checkPageSafety(api, tab),
    now, uuid: () => crypto.randomUUID(),
  };

  function queued(task) {
    const next = actionQueue.then(task, task);
    actionQueue = next.catch(() => undefined);
    return next;
  }

  async function settings() {
    const stored = await api.storage.local.get('settings');
    return validateSettings(stored.settings === undefined ? DEFAULT_SETTINGS : stored.settings);
  }

  async function syncAlarm(configuration) {
    if (!configuration.automatic) {
      await api.alarms.clear(ALARM_NAME);
      return;
    }
    if (!(await api.alarms.get(ALARM_NAME))) {
      await api.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: 1 });
    }
  }

  async function preview(allowProtected = false, sweep = false) {
    const configuration = await settings();
    const tabs = await api.tabs.query({});
    const options = { allowProtected, sweep };
    const proposed = selectCandidates(tabs, configuration, now(), options);
    const checked = await Promise.all(proposed.map(async (tab) => ({ tab, reason: sweep || configuration.allSites ? await checkPageSafety(api, tab) : null })));
    const candidates = checked.filter(({ reason }) => reason === null).map(({ tab }) => tab);
    const blockedTabs = tabs
      .map((tab) => ({ tab, decision: evaluateTab(tab, configuration, now(), options) }))
      .filter(({ decision }) => !decision.eligible)
      .map(({ tab, decision }) => ({ id: tab.id, title: typeof tab.title === 'string' ? tab.title.slice(0, 200) : 'タイトル不明', reason: decision.reason }));
    const stored = await api.storage.local.get(['lastRun', 'lastError']);
    const inspectedBlocks = checked.filter(({ reason }) => reason !== null).map(({ tab, reason }) => ({ id: tab.id, title: tab.title, reason }));
    return { settings: configuration, candidates, archiveCount: (await archiveApi.getArchive()).length, blockedTabs: [...blockedTabs, ...inspectedBlocks], totalTabs: tabs.length, discardedTabs: tabs.filter((tab) => tab.discarded === true).length, lastRun: stored.lastRun ?? null, lastError: typeof stored.lastError === 'string' ? stored.lastError : null };
  }

  function execute(candidates, automatic, allowProtected = false, sweep = false) {
    const task = async () => {
      const result = await discardCandidates(candidates, {
        getSettings: settings,
        getTab: (id) => api.tabs.get(id),
        discardTab: (id) => api.tabs.discard(id),
        checkPage: (tab) => checkPageSafety(api, tab),
        now,
      }, { automatic, allowProtected, sweep });
      await api.storage.local.set({ lastRun: { timestamp: new Date(now()).toISOString(), automatic, discardedCount: result.discarded.length, skippedCount: result.skipped.length, failedCount: result.failed.length }, lastError: null });
      return result;
    };
    return queued(task);
  }

  async function handle(request, sender) {
    const allowedPages = ['popup.html', 'options.html'].map((path) => api.runtime.getURL(path));
    if (sender?.id !== api.runtime.id || !allowedPages.includes(sender.url)) {
      throw new Error('この画面からは操作できません。Memoriqを開き直してください。');
    }
    const message = validateRequest(request);
    if (message.action === 'get-settings') return settings();
    if (message.action === 'get-archive') return archiveApi.getArchive();
    if (message.action === 'restore-archive') return queued(() => restoreArchive(archiveApi, message.entryId));
    if (message.action === 'preview') return preview(message.allowProtected, message.sweep);
    if (message.action === 'save-settings') {
      await api.storage.local.set({ settings: message.settings, lastError: null });
      try {
        await syncAlarm(message.settings);
        return { settings: message.settings, warning: null };
      } catch (error) {
        console.error('Memoriq: alarm setup failed', error);
        const warning = '設定は保存されましたが、自動休止のタイマーを更新できませんでした。設定をもう一度保存してください。';
        await api.storage.local.set({ lastError: warning });
        return { settings: message.settings, warning };
      }
    }
    if (message.action === 'discard') return execute(message.candidates, false, message.allowProtected, message.sweep);
    if (message.action === 'archive') return queued(() => archiveCandidates(message.candidates, archiveApi, { allowProtected: message.allowProtected, sweep: message.sweep }));
    if (message.action === 'snapshot') {
      try {
        const response = await api.runtime.sendNativeMessage(NATIVE_HOST, { version: 1, action: 'snapshot' });
        return validateSnapshot(response);
      } catch (error) {
        console.error('Memoriq: native snapshot unavailable', error);
        throw new Error('Macアプリとの連携を利用できません。アプリ側で連携を設定してください。タブの休止は拡張単体で使えます。');
      }
    }
    throw new Error('この操作には対応していません。');
  }

  async function onAlarm(alarm) {
    if (alarm.name !== ALARM_NAME) return;
    const configuration = await settings();
    if (!configuration.automatic) return;
    const candidates = selectCandidates(await api.tabs.query({}), configuration, now());
    if (candidates.length > 0) await execute(candidates, true);
  }

  async function initialize() {
    await syncAlarm(await settings());
  }

  async function recordFailure(error) {
    console.error('Memoriq: background operation failed', error);
    await api.storage.local.set({ lastError: '自動休止の処理に失敗しました。設定を確認して保存し直してください。' });
  }

  return { handle, onAlarm, initialize, recordFailure };
}
