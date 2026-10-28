import { announce, bytes, element, errorText, node, request } from './ui.mjs';

let candidates = [];
let busy = false;

const selected = () => candidates.filter(({ id }) => element(`candidate-${id}`)?.checked);

function updateButton() {
  const count = selected().length;
  element('discard').disabled = busy || count === 0;
  element('discard').textContent = count > 0 ? `選択した ${count} 件を休止する` : '選択したタブを休止する';
}

function renderCandidates(items) {
  candidates = items;
  const rows = items.map((candidate) => {
    const row = node('label', undefined, 'candidate');
    const checkbox = node('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
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
  const data = await request('preview', { allowProtected: element('manual-protected').checked });
  element('tab-count').textContent = String(data.totalTabs);
  element('discarded-count').textContent = String(data.discardedTabs);
  element('automatic').textContent = data.settings.automatic ? 'ON' : 'OFF';
  element('automatic').dataset.enabled = String(data.settings.automatic);
  element('policy-summary').textContent = `許可 ${data.settings.allowedHosts.length} サイト · ${data.settings.minimumIdleMinutes}分以上未使用 · 古い順に最大3件`;
  renderCandidates(data.candidates);
  const reasons = { active: '表示中・選択中', pinned: '固定タブ', audible: '音声を再生中', discarded: '休止済み', protected: 'Chromeが自動休止を保護', loading: '読み込み中', incognito: 'シークレット', 'unsupported-url': '対象外のURL', excluded: '除外サイト', 'not-allowed': '未許可サイト', 'unknown-access': '最終利用時刻を確認できません', recent: '未使用時間が不足', unknown: 'タブ情報を確認できません' };
  element('blocked-tabs').replaceChildren(...data.blockedTabs.map((tab) => node('li', `${tab.title}：${reasons[tab.reason] ?? reasons.unknown}`)));
  if (data.lastError) announce(data.lastError, true);
}

async function runBusy(action) {
  if (busy) return;
  busy = true;
  element('refresh').disabled = true;
  element('manual-protected').disabled = true;
  updateButton();
  try { await action(); }
  catch (error) { announce(errorText(error), true); }
  finally {
    busy = false;
    element('refresh').disabled = false;
    element('manual-protected').disabled = false;
    updateButton();
  }
}

element('refresh').addEventListener('click', () => runBusy(async () => {
  announce('');
  await refresh();
}));

element('manual-protected').addEventListener('change', () => runBusy(async () => {
  await refresh();
  announce(element('manual-protected').checked ? '今回の手動操作だけに適用します。入力途中のページは選択しないでください。自動休止の保護設定は変更しません。' : '自動休止が保護されたタブを候補から除外しました。');
}));

element('discard').addEventListener('click', () => runBusy(async () => {
  const descriptors = selected().map(({ id, url, lastAccessed }) => ({ id, url, lastAccessed }));
  if (descriptors.length === 0) return;
  const result = await request('discard', { candidates: descriptors, allowProtected: element('manual-protected').checked });
  await refresh();
  announce(`${result.discarded.length}件を休止しました。状態の変化などで見送り ${result.skipped.length}件、失敗 ${result.failed.length}件。`, result.failed.length > 0);
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
