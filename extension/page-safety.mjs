// Form comparisons adapted from Drowzy (MIT), Copyright (c) 2026 ml3dev.
// See vendor/drowzy-LICENSE.txt and THIRD_PARTY_NOTICES.md for source and changes.
export const PAGE_ORIGINS = Object.freeze(['http://*/*', 'https://*/*']);
const CHECK_TIMEOUT_MS = 2_000;

// Serialized by Chrome into an isolated world. Keep this function self-contained.
// Only a verdict is returned; field contents never leave the page.
export function inspectPage() {
  const fields = Array.from(document.querySelectorAll('input, textarea, select, [contenteditable]'));
  const dirty = fields.some((field) => {
    if (field.isContentEditable) return Boolean(field.textContent?.trim());
    if (field.tagName === 'SELECT') return Array.from(field.options).some((option) => option.selected !== option.defaultSelected);
    if (field.type === 'file') return field.files?.length > 0;
    if (['checkbox', 'radio'].includes(field.type)) return field.checked !== field.defaultChecked;
    if (['hidden', 'button', 'submit', 'reset', 'image'].includes(field.type)) return false;
    return field.value !== field.defaultValue;
  });
  const playing = document.pictureInPictureElement || Array.from(document.querySelectorAll('audio, video')).some((media) => !media.paused && !media.ended);
  // Custom editors in shadow DOM cannot be checked reliably by this scanner.
  const shadowEditor = Array.from(document.querySelectorAll('*')).some((element) => element.shadowRoot);
  return { reason: dirty ? 'form-input' : playing ? 'media' : shadowEditor ? 'page-unverified' : null, url: location.href, childFrames: document.querySelectorAll('iframe, frame').length };
}

export async function checkPageSafety(api, tab) {
  let timeout;
  try {
    if (!(await api.permissions.contains({ origins: [...PAGE_ORIGINS] }))) return 'page-unverified';
    const frames = await Promise.race([
      api.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: inspectPage }),
      new Promise((resolve) => { timeout = setTimeout(() => resolve(null), CHECK_TIMEOUT_MS); }),
    ]);
    if (!Array.isArray(frames) || frames.length === 0) return 'page-unverified';
    if (frames.find((frame) => frame.frameId === 0)?.result?.url !== tab.url) return 'page-unverified';
    if (frames.some(({ result }) => !result || !Number.isSafeInteger(result.childFrames) || result.childFrames < 0 || ![null, 'form-input', 'media', 'page-unverified'].includes(result.reason))) return 'page-unverified';
    if (frames.length !== 1 + frames.reduce((sum, frame) => sum + frame.result.childFrames, 0)) return 'page-unverified';
    return frames.find(({ result }) => result.reason !== null)?.result.reason ?? null;
  } catch (error) {
    console.warn('Memoriq: page safety inspection unavailable', { tabId: tab.id, message: error instanceof Error ? error.message : 'Unknown error' });
    return 'page-unverified';
  } finally { clearTimeout(timeout); }
}
