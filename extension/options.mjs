import { validateSettings } from './policy.mjs';
import { announce, element, errorText, request } from './ui.mjs';
import { PAGE_ORIGINS } from './page-safety.mjs';

function display(settings) {
  element('automatic').checked = settings.automatic;
  element('all-sites').checked = settings.allSites;
  element('idle').value = String(settings.minimumIdleMinutes);
  element('allowed').value = settings.allowedHosts.join('\n');
  element('excluded').value = settings.excludedHosts.join('\n');
}

const parseHosts = (value) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

element('settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  element('save').disabled = true;
  try {
    const settings = validateSettings({ automatic: element('automatic').checked, allSites: element('all-sites').checked, minimumIdleMinutes: Number(element('idle').value), allowedHosts: parseHosts(element('allowed').value), excludedHosts: parseHosts(element('excluded').value) });
    if (settings.allSites && !(await chrome.permissions.request({ origins: [...PAGE_ORIGINS] }))) throw new Error('サイトへのアクセスが許可されなかったため、設定を変更していません。');
    const result = await request('save-settings', { settings });
    display(result.settings);
    announce(result.warning ?? (!settings.allSites && settings.allowedHosts.length === 0 ? '保存しました。許可サイトが空のため、タブは休止されません。' : '保存しました。次に拡張の一覧から候補を確認できます。'), Boolean(result.warning));
  } catch (error) { announce(errorText(error), true); }
  finally { element('save').disabled = false; }
});

try {
  display(await request('get-settings'));
  element('fields').disabled = false;
} catch (error) { announce(errorText(error), true); }
