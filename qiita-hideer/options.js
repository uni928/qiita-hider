(() => {
  "use strict";

  const STORAGE_KEY = "qiita_article_filter_settings_v1";

  const DEFAULTS = {
    enabled: true,
    showPanel: true,

    hideNoImage: false,
    hideShortTitle30: false,
    hideShortBody50: false,
    hideCodeOnly: false,
    hideManyCodeBlocks: false,
    hideFewSentences: false,
    hideManyBullets: false,
    hideManyHeadings: false,
    hideHasAiKeywords: true,
    hideHasTemplatePhrases: false,
    hideHasExcessiveEmojis: false,
    hideHasLowInfoDensity: false,

    titleMaxLen: 30,
    bodyMaxLen: 50,
    minSentenceCount: 3,
    codeBlockMin: 4,
    bulletMin: 12,
    headingMin: 10,
    emojiMax: 12,
    lowInfoDensityMinLen: 800
  };

  const CONDITION_DEFS = [
    { key: "hideHasAiKeywords", label: "ChatGPTで生成した可能性の高い記事" },

    { key: "hideNoImage", label: "画像なし" },
    { key: "hideShortTitle30", label: "タイトル30文字以下" },
    { key: "hideShortBody50", label: "本文50文字以下" },
    { key: "hideCodeOnly", label: "コードのみ" },
    { key: "hideManyCodeBlocks", label: "コードブロック多め" },
    { key: "hideFewSentences", label: "文章が少なすぎる" },
    { key: "hideManyBullets", label: "箇条書きだらけ" },
    { key: "hideManyHeadings", label: "見出しだらけ" },
    { key: "hideHasTemplatePhrases", label: "テンプレ臭い定型句が多い" },
    { key: "hideHasExcessiveEmojis", label: "絵文字が多すぎる" },
    { key: "hideHasLowInfoDensity", label: "情報密度が低そう" }
  ];

  const THRESHOLD_DEFS = [
    { key: "titleMaxLen", label: "タイトル最大文字数", min: 1, max: 200 },
    { key: "bodyMaxLen", label: "本文最大文字数", min: 1, max: 2000 },
    { key: "minSentenceCount", label: "最低文数", min: 1, max: 50 },
    { key: "codeBlockMin", label: "コードブロック最小数", min: 1, max: 50 },
    { key: "bulletMin", label: "箇条書き最小数", min: 1, max: 200 },
    { key: "headingMin", label: "見出し最小数", min: 1, max: 200 },
    { key: "emojiMax", label: "絵文字最大数", min: 0, max: 200 },
    { key: "lowInfoDensityMinLen", label: "密度判定の最低文字数", min: 100, max: 20000 }
  ];

  const $ = (id) => document.getElementById(id);

  function storageGet() {
    return new Promise(resolve => {
      chrome.storage.sync.get([STORAGE_KEY], (obj) => {
        const v = obj && obj[STORAGE_KEY];
        resolve({ ...DEFAULTS, ...(v && typeof v === "object" ? v : {}) });
      });
    });
  }

  function storageSet(settings) {
    return new Promise(resolve => {
      chrome.storage.sync.set({ [STORAGE_KEY]: settings }, () => resolve());
    });
  }

  function row(labelLeft, rightEl) {
    const d = document.createElement("div");
    d.className = "row";
    const l = document.createElement("div");
    l.appendChild(labelLeft);
    d.appendChild(l);
    d.appendChild(rightEl);
    return d;
  }

  function mkCheckbox(def, settings) {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!settings[def.key];
    cb.dataset.key = def.key;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(" " + def.label));
    return label;
  }

  function mkNumber(def, settings) {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "10px";

    const left = document.createElement("div");
    left.textContent = def.label;

    const ip = document.createElement("input");
    ip.type = "number";
    ip.min = String(def.min);
    ip.max = String(def.max);
    ip.step = "1";
    ip.value = String(settings[def.key] ?? "");
    ip.dataset.key = def.key;

    wrap.appendChild(left);
    wrap.appendChild(ip);
    return wrap;
  }

  function collect() {
    const s = { ...DEFAULTS };
    s.enabled = $("enabled").checked;
    s.showPanel = $("showPanel").checked;

    for (const el of document.querySelectorAll("#checks input[type=checkbox]")) {
      const k = el.dataset.key;
      if (!k) continue;
      s[k] = el.checked;
    }

    for (const el of document.querySelectorAll("#nums input[type=number]")) {
      const k = el.dataset.key;
      if (!k) continue;
      const def = THRESHOLD_DEFS.find(x => x.key === k);
      const n = Number(el.value);
      if (!Number.isFinite(n) || !def) continue;
      s[k] = Math.max(def.min, Math.min(def.max, Math.trunc(n)));
      el.value = String(s[k]);
    }

    return s;
  }

  function render(settings) {
    $("enabled").checked = !!settings.enabled;
    $("showPanel").checked = !!settings.showPanel;

    const checks = $("checks");
    checks.innerHTML = "";
    for (const def of CONDITION_DEFS) {
      const label = mkCheckbox(def, settings);
      checks.appendChild(row(label, document.createElement("div")));
    }

    const nums = $("nums");
    nums.innerHTML = "";
    for (const def of THRESHOLD_DEFS) {
      const widget = mkNumber(def, settings);
      nums.appendChild(row(document.createTextNode(""), widget));
    }
  }

  function flashSaved() {
    const s = $("saved");
    s.hidden = false;
    setTimeout(() => (s.hidden = true), 900);
  }

  (async () => {
    let settings = await storageGet();
    render(settings);

    $("save").addEventListener("click", async () => {
      settings = collect();
      await storageSet(settings);
      flashSaved();
    });

    $("reset").addEventListener("click", async () => {
      settings = { ...DEFAULTS };
      render(settings);
      await storageSet(settings);
      flashSaved();
    });
  })();
})();
