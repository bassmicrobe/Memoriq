import { announce, bytes, element, errorText, node, request } from './ui.mjs';
import { PAGE_ORIGINS } from './page-safety.mjs';
import { sampleChrome } from './measurement.mjs';
import { exportBookmarks } from './archive.mjs';

let candidates = [];
let busy = false;
let sweep = false;
let archiveCount = 0;

const selected = () => candidates.filter(({ id }) => element(`candidate-${id}`)?.checked);

function updateButton() {
  const count = selected().length;
  element('discard').disabled = busy || count === 0;
  element('archive').disabled = busy || count === 0;
  element('discard').textContent = count > 0 ? `選択した ${count} 件を休止する` : '選択したタブを休止する';
}

function renderCandidates(items) {
  candidates = items;
  const rows = items.map((candidate) => {
    const row = node('label', undefined, 'candidate');
    const checkbox = node('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !sweep;
    checkbox.id = `candidate-${candidate.id}`;
    checkbox.addEventListener('change', updateButton);
    const copy = node('span', undefined, 'candidate-copy');
    copy.append(node('strong', candidate.title), node('span', `${candidate.hostname} · ${candidate.idleMinutes}分未使用`, 'muted'));
    row.append(checkbox, copy);
    return row;
  });
  element('candidates').replaceChildren(...(rows.length > 0 ? rows : [node('p', '今は休止できる候補がありません。許可サイトと未使用時間を設定で確認できます。', 'empty')]));
  updateButton();
}

async function refresh() {
  const data = await request('preview', { allowProtected: element('manual-protected').checked, sweep });
  element('tab-count').textContent = String(data.totalTabs);
  element('discarded-count').textContent = String(data.discardedTabs);
  element('automatic').textContent = data.settings.automatic ? 'ON' : 'OFF';
  element('automatic').dataset.enabled = String(data.settings.automatic);
  archiveCount = data.archiveCount;
  element('archive-count').textContent = `退避 ${archiveCount}枚`;
  element('restore').disabled = busy || archiveCount === 0;
  element('archive-panel').hidden = archiveCount === 0;
  const archived = archiveCount > 0 ? await request('get-archive') : [];
  element('archived-tabs').replaceChildren(...archived.map((entry) => {
    const row = node('li');
    const restore = node('button', '戻す', 'quiet');
    restore.type = 'button';
    restore.disabled = busy;
    restore.addEventListener('click', () => runBusy(() => restoreSaved(entry.id)));
    row.append(node('span', entry.title || new URL(entry.url).hostname), restore);
    return row;
  }));
  element('policy-summary').textContent = `${sweep ? '全サイト · 待ち時間なし' : `${data.settings.allSites ? '全サイト' : `許可 ${data.settings.allowedHosts.length} サイト`} · ${data.settings.minimumIdleMinutes}分以上未使用`} · 古い順に最大50件`;
  renderCandidates(data.candidates);
  const reasons = { active: '表示中・選択中', pinned: '固定タブ', audible: '音声を再生中', discarded: '休止済み', protected: 'Chromeが自動休止を保護', loading: '読み込み中', incognito: 'シークレット', 'unsupported-url': '対象外のURL', excluded: '除外サイト', 'not-allowed': '未許可サイト', 'unknown-access': '最終利用時刻を確認できません', recent: '未使用時間が不足', unknown: 'タブ情報を確認できません' };
  const pageReasons = { ...reasons, 'work-site': '会議・編集用サイトを保護', 'form-input': '未保存の入力を保護', media: '再生中のメディアを保護', 'page-unverified': '入力状態を確認できないため保護' };
  element('blocked-tabs').replaceChildren(...data.blockedTabs.map((tab) => node('li', `${tab.title}：${pageReasons[tab.reason] ?? reasons.unknown}`)));
  element('select-all').disabled = busy || candidates.length === 0;
  if (data.lastError) announce(data.lastError, true);
}

async function runBusy(action) {
  if (busy) return;
  busy = true;
  element('refresh').disabled = true;
  element('manual-protected').disabled = true;
  element('sweep').disabled = true;
  element('select-all').disabled = true;
  element('restore').disabled = true;
  element('export-archive').disabled = true;
  element('archived-tabs').querySelectorAll('button').forEach((button) => { button.disabled = true; });
  updateButton();
  try { await action(); }
  catch (error) { announce(errorText(error), true); }
  finally {
    busy = false;
    element('refresh').disabled = false;
    element('manual-protected').disabled = false;
    element('sweep').disabled = false;
    element('select-all').disabled = candidates.length === 0;
    element('restore').disabled = archiveCount === 0;
    element('export-archive').disabled = archiveCount === 0;
    element('archived-tabs').querySelectorAll('button').forEach((button) => { button.disabled = false; });
    updateButton();
  }
}

element('refresh').addEventListener('click', () => runBusy(async () => {
  announce('');
  await refresh();
}));

element('sweep').addEventListener('click', () => runBusy(async () => {
  if (!sweep && !(await chrome.permissions.request({ origins: [...PAGE_ORIGINS] }))) throw new Error('サイトへのアクセスが許可されなかったため、一括整理は開始していません。');
  sweep = !sweep;
  element('manual-protected').checked = sweep;
  element('sweep').setAttribute('aria-pressed', String(sweep));
  element('sweep').textContent = sweep ? '通常の候補に戻る' : '保護タブも含めてまとめて整理 ↗';
  element('sweep-note').hidden = !sweep;
  await refresh();
  announce(sweep ? '入力状態を確認しました。休止する候補を選択してください。' : '通常の候補に戻しました。');
}));

element('select-all').addEventListener('click', () => {
  if (busy) return;
  candidates.forEach(({ id }) => { element(`candidate-${id}`).checked = true; });
  updateButton();
});

element('manual-protected').addEventListener('change', () => runBusy(async () => {
  await refresh();
  announce(element('manual-protected').checked ? '今回の手動操作だけに適用します。入力途中のページは選択しないでください。自動休止の保護設定は変更しません。' : '自動休止が保護されたタブを候補から除外しました。');
}));

async function organize(action) {
  const descriptors = selected().map(({ id, url, lastAccessed }) => ({ id, url, lastAccessed }));
  if (descriptors.length === 0) return;
  if (action === 'archive' && !(await chrome.permissions.request({ origins: [...PAGE_ORIGINS] }))) throw new Error('入力チェックの権限がないため退避していません。');
  let before = null;
  let measureError = null;
  element('measurement').textContent = 'Chrome系アプリのメモリを計測中…';
  try { before = await sampleChrome(request); }
  catch (error) { measureError = errorText(error); }
  let result;
  try { result = await request(action, { candidates: descriptors, allowProtected: element('manual-protected').checked, sweep }); }
  catch (error) { element('measurement').textContent = '整理を完了できなかったため、前後差は表示していません。'; throw error; }
  await refresh();
  const completed = action === 'archive' ? result.archived.length : result.discarded.length;
  announce(`${completed}件を${action === 'archive' ? '退避' : '休止'}しました。状態の変化などで見送り ${result.skipped.length}件、失敗 ${result.failed.length}件。`, result.failed.length > 0);
  if (before !== null) {
    try {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const after = await sampleChrome(request);
      const difference = before - after;
      element('measurement').textContent = `Chrome系アプリ合計 ${bytes(before)} → ${bytes(after)}（${bytes(Math.abs(difference))}${difference >= 0 ? '減少' : '増加'}）。前後各3回の中央値。ほかのタブやアプリの変動も含む観測差です。`;
    } catch (error) { element('measurement').textContent = `休止後の計測を完了できませんでした。${errorText(error)}`; }
  } else { element('measurement').textContent = `削減量は未計測です。${measureError}`; }
}

element('discard').addEventListener('click', () => runBusy(() => organize('discard')));
element('archive').addEventListener('click', () => runBusy(() => organize('archive')));
async function restoreSaved(entryId) {
  const result = await request('restore-archive', entryId === undefined ? {} : { entryId });
  await refresh();
  announce(`${result.restoredCount}枚をバックグラウンドに戻しました。`);
}
element('restore').addEventListener('click', () => runBusy(() => restoreSaved()));
element('export-archive').addEventListener('click', () => runBusy(async () => {
  const archive = await request('get-archive');
  const url = URL.createObjectURL(new Blob([exportBookmarks(archive)], { type: 'text/html;charset=utf-8' }));
  const link = node('a');
  link.href = url;
  link.download = 'Memoriq-tabs.html';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  announce('退避したURLのバックアップ保存を開始しました。');
}));

element('settings').addEventListener('click', async () => {
  try { await chrome.runtime.openOptionsPage(); }
  catch (error) { announce(errorText(error), true); }
});

element('snapshot').addEventListener('click', async () => {
  element('snapshot').disabled = true;
  try {
    const data = await request('snapshot');
    const pressure = { normal: '正常', warning: '注意', critical: '高い', unknown: '不明' }[data.memory.pressure];
    const summary = node('p', `物理メモリ ${bytes(data.memory.totalBytes)} · スワップ ${bytes(data.memory.swapUsedBytes)} · 圧迫 ${pressure}`, 'muted');
    const list = node('ul', undefined, 'app-list');
    list.append(...data.apps.toSorted((a, b) => b.footprintBytes - a.footprintBytes).slice(0, 5).map((app) => {
      const row = node('li');
      row.append(node('span', `${app.name}${app.protected ? ' · 保護' : ''}`), node('strong', bytes(app.footprintBytes)));
      return row;
    }));
    const note = node('p', `${new Date(data.timestamp).toLocaleTimeString('ja-JP')} 計測 · 読み取れないプロセス ${data.unreadableProcessCount}件。休止による削減量の推計ではありません。`, 'hint');
    element('native-data').replaceChildren(summary, list, note);
  } catch (error) {
    element('native-data').replaceChildren(node('p', errorText(error), 'muted'));
  } finally { element('snapshot').disabled = false; }
});

await runBusy(refresh);
