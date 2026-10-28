import { createController } from './controller.mjs';

const controller = createController(chrome);

function background(promise) {
  promise.catch((error) => controller.recordFailure(error)).catch((error) => {
    console.error('Memoriq: failed to save error status', error);
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  controller.handle(request, sender)
    .then((data) => sendResponse({ ok: true, data, error: null }))
    .catch((error) => {
      console.error('Memoriq: request failed', error);
      sendResponse({ ok: false, data: null, error: error instanceof Error ? error.message : '操作を完了できませんでした。' });
    });
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => background(controller.onAlarm(alarm)));
chrome.runtime.onInstalled.addListener(() => background(controller.initialize()));
chrome.runtime.onStartup.addListener(() => background(controller.initialize()));
background(controller.initialize());
