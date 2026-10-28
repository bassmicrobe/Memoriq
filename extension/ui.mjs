export const element = (id) => document.getElementById(id);

export async function request(action, parameters = {}) {
  const response = await chrome.runtime.sendMessage({ action, ...parameters });
  if (!response || response.ok !== true) throw new Error(typeof response?.error === 'string' ? response.error : '拡張との通信に失敗しました。画面を開き直してください。');
  return response.data;
}

export function announce(message, isError = false) {
  const status = element('status');
  status.textContent = message;
  status.dataset.error = String(isError);
}

export function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

export function bytes(value) {
  return value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${Math.round(value / 1024 ** 2)} MB`;
}

export function errorText(error) {
  return error instanceof Error ? error.message : '操作を完了できませんでした。';
}
