(() => {
  "use strict";

  const BODY_SELECTOR = ".it-MdContent";
  const ARTICLE_SELECTOR = "article";
  const MAX_CONCURRENT_FETCH = 3;

  const STORAGE_KEY = "qiita_article_filter_settings_v1";
  const CACHE_PREFIX = "qiita_article_metrics_v1:"; // sessionStorage

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
    hideHasAiKeywords: true, // 現コードのやっていたこと相当の名称
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

  function cssText() {
    return `
#qaf-panel{position:fixed;top:12px;right:12px;z-index:2147483647;background:#fff;border:1px solid #ddd;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.12);width:340px;max-height:78vh;overflow:auto;font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;}
#qaf-panel *{box-sizing:border-box;}
#qaf-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #eee;}
#qaf-title{font-weight:700;}
#qaf-mini{display:flex;gap:8px;align-items:center;}
#qaf-body{padding:10px 12px;display:grid;gap:10px;}
.qaf-row{display:flex;align-items:center;justify-content:space-between;gap:10px;}
.qaf-row label{display:flex;gap:8px;align-items:center;user-select:none;}
.qaf-row input[type="number"]{width:96px;padding:4px 6px;border:1px solid #ddd;border-radius:8px;}
.qaf-section{border:1px solid #eee;border-radius:10px;padding:10px;display:grid;gap:8px;}
.qaf-section h4{margin:0;font-size:12px;color:#555;}
.qaf-btn{border:1px solid #ddd;background:#f7f7f7;border-radius:10px;padding:6px 10px;cursor:pointer;}
.qaf-btn:active{transform:translateY(1px);}
.qaf-muted{color:#777;font-size:12px;}
.qaf-divider{height:1px;background:#eee;margin:2px 0;}
`;
  }

  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "style" && v && typeof v === "object") Object.assign(e.style, v);
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) e.setAttribute(k, String(v));
    }
    for (const c of children) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    return e;
  }

  function normalizeUrl(href) {
    try {
      const u = new URL(href, location.origin);
      u.hash = "";
      u.search = "";
      return u.toString();
    } catch {
      return null;
    }
  }

  function isItemUrl(url) {
    try {
      const u = new URL(url);
      return /^\/[^\/]+\/items\/[^\/]+$/.test(u.pathname);
    } catch {
      return false;
    }
  }

  function cacheGet(url) {
    try {
      const raw = sessionStorage.getItem(CACHE_PREFIX + url);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : null;
    } catch {
      return null;
    }
  }

  function cacheSet(url, metrics) {
    try {
      sessionStorage.setItem(CACHE_PREFIX + url, JSON.stringify(metrics));
    } catch {}
  }

  async function fetchHtml(url, signal) {
    const res = await fetch(url, {
      credentials: "include",
      headers: { Accept: "text/html" },
      signal
    });
    if (!res.ok) throw new Error(String(res.status));
    return res.text();
  }

  function safeText(node) {
    return (node && node.textContent ? node.textContent : "").replace(/\s+/g, " ").trim();
  }

  function countMatches(str, re) {
    if (!str) return 0;
    const m = str.match(re);
    return m ? m.length : 0;
  }

function countEmojiLineStarts(text) {
  if (!text) return 0;
  const lines = text.split(/\r?\n/);
  let c = 0;
  for (const line of lines) {
    const s = line.trimStart();
    if (!s) continue;
    // 行頭が絵文字（サロゲート/記号含む広めの範囲）
    if (/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s)) c++;
  }
  return c;
}

function remainAst(text) {
  return (text && text.includes("**")) ? 100 : 0;
}

function aiHeuristicScore(title, bodyText, rawMdText) {
  const t = (title || "");
  const b = (bodyText || "");
  const raw = (rawMdText || b);

  // 1) 露骨な自己申告・生成ログっぽい言い回し
  const strongPats = [
    /chatgpt|openai|gpt[-\s]?\d/i,
    /(ai|人工知能).{0,6}(生成|出力)/i,
    /(以下|下記).{0,6}(の)?(コード|全文|結果|出力)/i,
    /プロンプト/i,
    /as an ai language model/i
  ];

  // 2) ChatGPTに多い文章構造・定型
  const stylePats = [
    /結論(から|として)/,
    /要点(は|を)/,
    /(ポイント|まとめ)(は|ると)/,
    /(手順|ステップ)\s*\d+/,
    /(メリット|デメリット)/,
    /(注意点|補足|前提)/,
    /(まず|次に|最後に)/,
    /FAQ|よくある質問/i
  ];

  // 3) 箇条書き・見出し・セクション過多
  const headingCount = (raw.match(/^\s{0,3}#{2,6}\s+/gm) || []).length;
  const bulletCount = (raw.match(/^\s*[-*+]\s+/gm) || []).length;
  const numberedCount = (raw.match(/^\s*\d+\.\s+/gm) || []).length;

  // 4) 行頭絵文字ルール（5行以上でAI判定に寄せる）
  const emojiLineStarts = countEmojiLineStarts(raw);

  // 5) 句読点・整形の均質さ（雑スコア）
  const len = Math.max(1, [...b].length);
  const commaLike = (b.match(/[、，,]/g) || []).length;
  const periodLike = (b.match(/[。．.]/g) || []).length;
  const punctuationRatio = (commaLike + periodLike) / len;

  let score = 0;

  for (const p of strongPats) if (p.test(t) || p.test(b)) score += 3;
  for (const p of stylePats) if (p.test(b)) score += 1;

  if (headingCount >= 8) score += 2;
  else if (headingCount >= 4) score += 1;

  if (bulletCount + numberedCount >= 18) score += 2;
  else if (bulletCount + numberedCount >= 10) score += 1;

  if (punctuationRatio >= 0.06) score += 1; // 過度に均一に整形されがち
  if (/```/.test(raw) && /^(?:\s*```[\s\S]*?```)\s*$/m.test(raw.trim())) score += 2; // コード塊＋説明薄め

  // 行頭絵文字5行以上 → 強めにAI寄せ
  if (emojiLineStarts >= 5) score += 4;

  return { score, emojiLineStarts, headingCount, bulletCount, numberedCount };
}

  function aiKeywordScore(text) {
    if (!text) return 0;
    const pats = [
/——/i,
      /chatgpt/i,
      /\bgpt[-\s]?4\b/i,
      /\bgpt[-\s]?3\.?5\b/i,
      /\bopenai\b/i,
      /生成(ai|文章|記事)/i,
      /プロンプト/i,
      /はじめに/i,
      /まとめ/i,
      /おわりに/i,
      /下記(の)?(コード|内容)/i,
      /結論から/i,
      /要約すると/i,
      /ステップ(は|として)/i,
      /注意点として/i,
      /ポイントは/i,
      /##\s|\n##\s|###\s/i
    ];
    let s = 0;
    for (const p of pats) if (p.test(text)) s += 2;
    return s;
  }

  function aiKeywordScore2(text) {
    if (!text) return 0;
const rareCharMatches = text.match(/[【】「」『』《》〈〉〔〕［］｛｝〓◆◇]/g);
const rareCharCount = rareCharMatches ? rareCharMatches.length : 0;

return rareCharCount * 2;
  }

function aiKeywordScore3(title) {
  if (!title) return 0;

  const pats = [
    /してみた/i,
    /してみる/i,
    /試してみた/i,
    /書いてみた/i,
    /作ってみた/i,
    /やってみた/i,
    /触ってみた/i,
    /調べてみた/i,

    /感想/i,
    /雑感/i,
    /備忘録/i,
    /メモ/i,
    /日記/i,
    /覚え書き/i,

    /なんとなく/i,
    /とりあえず/i,
    /多分/i,
    /ざっくり/i,

    /自分用/i,
    /個人用/i,
    /自分向け/i,
    /私用/i,
    /俺用/i
  ];

  let score = 0;

  for (const p of pats) {
    if (p.test(title)) score += 3;
  }

  return score;
}


  function templatePhraseScore(text) {
    if (!text) return 0;
    const pats = [
      /本記事では/gi,
      /この記事では/gi,
      /それでは見ていきましょう/gi,
      /まとめると/gi,
      /まずは/gi,
      /次に/gi,
      /最後に/gi,
      /以上です/gi,
      /結論/gi
    ];
    let s = 0;
    for (const p of pats) s += countMatches(text, p);
    return s;
  }

  function extractMetricsFromHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const md = doc.querySelector(BODY_SELECTOR);

    if (!md) {
      return {
        ok: false,
        hasImg: true,
        titleLen: 9999,
        bodyTextLen: 9999,
        sentenceCount: 9999,
        codeBlockCount: 0,
        bulletCount: 0,
        headingCount: 0,
        emojiCount: 0,
        isCodeOnly: false,
        aiScore: 0,
        templateScore: 0,
        infoDensity: 1
      };
    }

    const title = safeText(doc.querySelector("h1")) || safeText(doc.querySelector("title"));
    const titleLen = [...title].length;

    const bodyText = safeText(md);
    const bodyTextLen = [...bodyText].length;

    const hasImg = md.querySelector("img") !== null;

    const codeBlockCount = md.querySelectorAll("pre code, pre").length;
    const inlineCodeCount = md.querySelectorAll("code").length;

    const bulletCount = md.querySelectorAll("ul li, ol li").length;
    const headingCount = md.querySelectorAll("h1,h2,h3,h4,h5,h6").length;

    const sentenceCount = (() => {
      const s = bodyText
        .replace(/[。！？!?]/g, "。")
        .split("。")
        .map(x => x.trim())
        .filter(Boolean);
      return s.length;
    })();

    const emojiCount = countMatches(bodyText, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu);

    const paragraphTextLen = (() => {
      const ps = [...md.querySelectorAll("p")].map(p => safeText(p)).join(" ");
      return [...ps].length;
    })();

    const isCodeOnly = paragraphTextLen === 0 && (codeBlockCount > 0 || inlineCodeCount > 10);
const rawMdText = md.innerText || md.textContent || "";
const ai = aiHeuristicScore(title, bodyText, rawMdText);

const aiScore =
  aiKeywordScore(bodyText) +
  aiKeywordScore(title) -
//aiKeywordScore2(bodyText) - 
aiKeywordScore2(title) -
aiKeywordScore3(title) + 
  ai.score +
  remainAst(rawMdText);
//console.log(aiScore);
    const templateScore = templatePhraseScore(bodyText);

    const infoDensity = (() => {
      const nonWord = countMatches(bodyText, /[^\p{L}\p{N}]/gu);
      const wordish = Math.max(1, bodyTextLen - nonWord);
      return wordish / Math.max(1, bodyTextLen);
    })();

    return {
      ok: true,
      hasImg,
      titleLen,
      bodyTextLen,
      sentenceCount,
      codeBlockCount,
      bulletCount,
      headingCount,
      emojiCount,
      isCodeOnly,
      aiScore,
      templateScore,
      infoDensity
    };
  }

  function shouldHide(metrics, s) {
    if (!s.enabled) return false;

    if (s.hideHasAiKeywords) {
      if (metrics.aiScore >= 12) return true;
    }
    if (s.hideNoImage && metrics.hasImg === false) return true;
    if (s.hideShortTitle30 && metrics.titleLen <= (s.titleMaxLen | 0)) return true;
    if (s.hideShortBody50 && metrics.bodyTextLen <= (s.bodyMaxLen | 0)) return true;
    if (s.hideCodeOnly && metrics.isCodeOnly) return true;
    if (s.hideManyCodeBlocks && metrics.codeBlockCount >= (s.codeBlockMin | 0)) return true;
    if (s.hideFewSentences && metrics.sentenceCount <= (s.minSentenceCount | 0)) return true;
    if (s.hideManyBullets && metrics.bulletCount >= (s.bulletMin | 0)) return true;
    if (s.hideManyHeadings && metrics.headingCount >= (s.headingMin | 0)) return true;
    if (s.hideHasTemplatePhrases && metrics.templateScore >= 6) return true;
    if (s.hideHasExcessiveEmojis && metrics.emojiCount > (s.emojiMax | 0)) return true;
    if (s.hideHasLowInfoDensity) {
      if (metrics.bodyTextLen >= (s.lowInfoDensityMinLen | 0) && metrics.infoDensity < 0.35) return true;
    }
    return false;
  }

  function hideArticle(article) {
    if (!(article instanceof HTMLElement)) return;
    article.style.display = "none";
  }

  async function storageGet() {
    return new Promise(resolve => {
      chrome.storage.sync.get([STORAGE_KEY], (obj) => {
        const v = obj && obj[STORAGE_KEY];
        resolve({ ...DEFAULTS, ...(v && typeof v === "object" ? v : {}) });
      });
    });
  }

  async function storageSet(settings) {
    return new Promise(resolve => {
      chrome.storage.sync.set({ [STORAGE_KEY]: settings }, () => resolve());
    });
  }

  function mountPanel(initialSettings) {
    const style = el("style", {}, [cssText()]);
    document.documentElement.appendChild(style);

    let settings = { ...initialSettings };

    const enabled = el("input", { type: "checkbox" });
    enabled.checked = !!settings.enabled;

    const showPanel = el("input", { type: "checkbox" });
    showPanel.checked = !!settings.showPanel;

    const btnReset = el("button", { class: "qaf-btn", type: "button" }, ["初期化"]);
    const btnCollapse = el("button", { class: "qaf-btn", type: "button" }, ["折"]);

    const head = el("div", { id: "qaf-head" }, [
      el("div", { id: "qaf-title" }, ["記事削減フィルタ"]),
      el("div", { id: "qaf-mini" }, [
        el("label", {}, [enabled, el("span", {}, ["有効"])]),
        el("label", {}, [showPanel, el("span", {}, ["パネル"])]),
        btnReset,
        btnCollapse
      ])
    ]);

    const body = el("div", { id: "qaf-body" }, []);
    const panel = el("div", { id: "qaf-panel" }, [head, body]);
    document.documentElement.appendChild(panel);

    let collapsed = false;
    btnCollapse.addEventListener("click", () => {
      collapsed = !collapsed;
      body.style.display = collapsed ? "none" : "grid";
      btnCollapse.textContent = collapsed ? "展" : "折";
    });

    const checkInputs = new Map();
    const numberInputs = new Map();

    async function emit() {
      await storageSet(settings);
    }

    enabled.addEventListener("change", () => {
      settings.enabled = enabled.checked;
      emit();
    });

    showPanel.addEventListener("change", () => {
      settings.showPanel = showPanel.checked;
      emit();
      if (!settings.showPanel) panel.remove();
    });

    btnReset.addEventListener("click", () => {
      settings = { ...DEFAULTS };
      syncAll();
      emit();
    });

    const sec1 = el("div", { class: "qaf-section" }, [
      el("h4", {}, ["チェックで「該当記事を非表示」"])
    ]);

    for (const def of CONDITION_DEFS) {
      const cb = el("input", { type: "checkbox" });
      cb.checked = !!settings[def.key];
      cb.addEventListener("change", () => {
        settings[def.key] = cb.checked;
        emit();
      });
      checkInputs.set(def.key, cb);

      sec1.appendChild(
        el("div", { class: "qaf-row" }, [
          el("label", {}, [cb, el("span", {}, [def.label])])
        ])
      );
    }

    sec1.appendChild(el("div", { class: "qaf-divider" }));
    //sec1.appendChild(el("div", { class: "qaf-muted" }, [
    //  "※「ChatGPTで生成した可能性の高い記事」は、現コードの挙動を名称変更したものです。"
    //]));

    const sec2 = el("div", { class: "qaf-section" }, [
      el("h4", {}, ["しきい値"])
    ]);

    for (const def of THRESHOLD_DEFS) {
      const ip = el("input", { type: "number", min: def.min, max: def.max, step: 1 });
      ip.value = String(settings[def.key] ?? "");
      ip.addEventListener("change", () => {
        const n = Number(ip.value);
        if (!Number.isFinite(n)) return;
        settings[def.key] = Math.max(def.min, Math.min(def.max, Math.trunc(n)));
        ip.value = String(settings[def.key]);
        emit();
      });
      numberInputs.set(def.key, ip);

      sec2.appendChild(
        el("div", { class: "qaf-row" }, [
          el("span", {}, [def.label]),
          ip
        ])
      );
    }

    body.appendChild(sec1);
    body.appendChild(sec2);

    function syncAll() {
      enabled.checked = !!settings.enabled;
      showPanel.checked = !!settings.showPanel;
      for (const [k, ip] of checkInputs.entries()) ip.checked = !!settings[k];
      for (const [k, ip] of numberInputs.entries()) ip.value = String(settings[k] ?? "");
    }

    return {
      get: () => ({ ...settings }),
      set: (s) => {
        settings = { ...DEFAULTS, ...(s && typeof s === "object" ? s : {}) };
        syncAll();
      }
    };
  }
  const queue = [];
  let active = 0;
  function enqueue(task) {
    queue.push(task);
    pump();
  }
  function pump() {
    while (active < MAX_CONCURRENT_FETCH && queue.length) {
      const task = queue.shift();
      active++;
      task().finally(() => {
        active--;
        pump();
      });
    }
  }

  const processed = new WeakSet();
  const inflight = new Map(); // url -> Promise<metrics>

  function getArticleLink(article) {
    const link = article.querySelector("a[href*='/items/']");
    if (!link) return null;
    const url = normalizeUrl(link.href);
    if (!url || !isItemUrl(url)) return null;
    return url;
  }

  function applyIfReady(article, metrics, settings) {
    if (shouldHide(metrics, settings)) hideArticle(article);
  }

  function scan(settings, force = false) {
    const articles = document.querySelectorAll(ARTICLE_SELECTOR);

    articles.forEach(article => {
      if (!force && processed.has(article)) return;
      processed.add(article);

      const url = getArticleLink(article);
      if (!url) return;

      const cached = cacheGet(url);
      if (cached) {
        applyIfReady(article, cached, settings);
        return;
      }

      if (inflight.has(url)) {
        inflight.get(url).then(m => applyIfReady(article, m, settings)).catch(() => {});
        return;
      }

      const p = (async () => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 10000);
        try {
          const html = await fetchHtml(url, ac.signal);
          const metrics = extractMetricsFromHtml(html);
          cacheSet(url, metrics);
          return metrics;
        } finally {
          clearTimeout(timer);
        }
      })();

      inflight.set(url, p);

      enqueue(async () => {
        try {
          const metrics = await p;
          applyIfReady(article, metrics, settings);
        } catch {
          // 失敗時は安全側（消さない）
        } finally {
          inflight.delete(url);
        }
      });
    });
  }

(async () => {
  let settings = await storageGet();

  // ここは「拡張自体の有効/無効」だけを見る
  if (!settings.enabled) return;

  // パネルは showPanel のときだけ作る（showPanel=false なら null）
  const panel = settings.showPanel
    ? mountPanel(settings, (s) => {
        settings = s;
        // 設定変更で再スキャン（フィルタは常に動く）
        scan(settings, true);
      })
    : null;

  // パネルがある時だけ初期反映
  if (panel) panel.set(settings);

  // 初回スキャン（パネルOFFでも実行）
  scan(settings);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (!changes[STORAGE_KEY]) return;

    const v = changes[STORAGE_KEY].newValue;
    settings = { ...DEFAULTS, ...(v && typeof v === "object" ? v : {}) };

    // 有効/無効が切られたら「以後は動かさない」方針なら return で止める
    // （止めずに scan だけ抑止するなら、shouldHide 内で enabled を見る方でもOK）
    if (!settings.enabled) return;

    // パネルがある時だけ反映
    if (panel) panel.set(settings);

    // パネルOFFでも設定変更を反映するため再スキャン
    scan(settings, true);
  });

  const observer = new MutationObserver(() => {
    // enabled=false のときは何もしない
    if (!settings.enabled) return;
    scan(settings);
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
})();
