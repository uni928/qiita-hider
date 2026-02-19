(() => {
  "use strict";

  const STORAGE_KEY = "qiita_article_filter_settings_v1";

  const DEFAULTS = {
    enabled: true,
    showPanel: true
  };

  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get([STORAGE_KEY], (obj) => {
        const v = obj && obj[STORAGE_KEY];
        const s = { ...DEFAULTS, ...(v && typeof v === "object" ? v : {}) };
        resolve(s);
      });
    });
  }

  async function shouldInject(tab) {
    if (!tab || !tab.url) return false;
    if (!/^https:\/\/qiita\.com\//.test(tab.url)) return false;
    const s = await getSettings();
    return !!(s.enabled && s.showPanel);
  }

  async function injectIfNeeded(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!(await shouldInject(tab))) return;

      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });
    } catch {
      // 失敗時は何もしない
    }
  }

  chrome.runtime.onInstalled.addListener(() => {
    // 初回用：設定が未作成なら showPanel を true で保存
    chrome.storage.sync.get([STORAGE_KEY], (obj) => {
      if (obj && obj[STORAGE_KEY]) return;
      chrome.storage.sync.set({ [STORAGE_KEY]: { ...DEFAULTS } });
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "complete") injectIfNeeded(tabId);
  });

  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    injectIfNeeded(activeInfo.tabId);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (!changes[STORAGE_KEY]) return;
    chrome.tabs.query({ url: "https://qiita.com/*" }, (tabs) => {
      for (const t of tabs) if (t.id) injectIfNeeded(t.id);
    });
  });
})();
