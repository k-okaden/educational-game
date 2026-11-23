/*
 * 共通ライブラリ（すべてのゲームで読み込む）
 * window.EG にまとめて生やす。ビルド不要・file:// でも動くように classic script にしている。
 *
 *   EG.numberWord(7)          -> "seven"
 *   EG.say("seven")           -> 英語で読み上げ
 *   EG.say("すごい！", "ja")  -> 日本語で読み上げ
 *   EG.sfx.correct()          -> 効果音
 *   EG.stars.add("counting")  -> ほしを1つ追加
 *   EG.renderBlocks(el, [{count:3, color:"a"}, {count:2, color:"b"}])
 *   EG.mountHeader({ title, gameId })
 *   EG.showReward({ onAgain, onHome })
 */
(function () {
  "use strict";
  const EG = (window.EG = window.EG || {});

  // ---------- 便利関数 ----------
  EG.randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  EG.shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  EG.wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /** 正解を含む n 個の選択肢（正解の近くの数を優先） */
  EG.makeChoices = (answer, n = 3, min = 0, max = 100) => {
    const set = new Set([answer]);
    const near = EG.shuffle([-2, -1, 1, 2, 3, -3, 10, -10]);
    for (const d of near) {
      if (set.size >= n) break;
      const v = answer + d;
      if (v >= min && v <= max) set.add(v);
    }
    while (set.size < n) set.add(EG.randInt(min, max));
    return EG.shuffle([...set]);
  };

  // ---------- 英語の数字 ----------
  const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  EG.numberWord = (n) => {
    if (n < 0) return "minus " + EG.numberWord(-n);
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "");
    if (n < 1000) {
      const r = n % 100;
      return ONES[Math.floor(n / 100)] + " hundred" + (r ? " and " + EG.numberWord(r) : "");
    }
    return String(n);
  };

  // ---------- 設定 ----------
  const SETTINGS_KEY = "eg.settings";
  const defaults = { sound: true, voice: true, rate: 0.85 };
  EG.settings = Object.assign({}, defaults, safeJSON(localStorage.getItem(SETTINGS_KEY)));
  EG.saveSettings = () => safeSet(SETTINGS_KEY, JSON.stringify(EG.settings));

  function safeJSON(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* プライベートモード等 */ } }

  // ---------- 読み上げ（Web Speech API） ----------
  let voices = [];
  const loadVoices = () => { try { voices = speechSynthesis.getVoices(); } catch { voices = []; } };
  if ("speechSynthesis" in window) {
    loadVoices();
    speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
  }
  function pickVoice(lang) {
    const want = lang === "ja" ? "ja" : "en";
    const list = voices.filter((v) => v.lang.toLowerCase().startsWith(want));
    // ききとりやすい声を優先
    const pref = want === "en"
      ? [/samantha/i, /google us english/i, /en-us/i, /karen/i, /daniel/i]
      : [/kyoko/i, /google 日本語/i, /o-ren/i, /ja-jp/i];
    for (const p of pref) {
      const v = list.find((v) => p.test(v.name) || p.test(v.lang));
      if (v) return v;
    }
    return list[0] || null;
  }
  /** 読み上げ。終わったら resolve する Promise を返す */
  EG.say = (text, lang = "en", { rate, interrupt = true } = {}) =>
    new Promise((resolve) => {
      if (!EG.settings.voice || !("speechSynthesis" in window)) return resolve();
      try {
        if (interrupt) speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang === "ja" ? "ja-JP" : "en-US";
        const v = pickVoice(lang);
        if (v) u.voice = v;
        u.rate = rate ?? EG.settings.rate;
        u.pitch = 1.1;
        let done = false;
        const fin = () => { if (!done) { done = true; resolve(); } };
        u.onend = fin;
        u.onerror = fin;
        setTimeout(fin, 1500 + text.length * 120); // 端末によって onend が来ない対策
        speechSynthesis.speak(u);
      } catch { resolve(); }
    });
  EG.sayNumber = (n) => EG.say(EG.numberWord(n));

  // ---------- 効果音（Web Audio、音声ファイル不要） ----------
  let ctx = null;
  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function tone(freq, start, dur, type = "sine", vol = 0.25) {
    const c = audio();
    if (!c || !EG.settings.sound) return;
    const t = c.currentTime + start;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  EG.sfx = {
    tap: () => tone(660, 0, 0.12, "triangle", 0.2),
    pop: (i = 0) => tone(440 * Math.pow(2, (i % 12) / 12), 0, 0.15, "triangle", 0.22),
    correct: () => { tone(784, 0, 0.15, "triangle"); tone(1047, 0.12, 0.3, "triangle"); },
    wrong: () => { tone(330, 0, 0.18, "sine", 0.18); tone(262, 0.15, 0.25, "sine", 0.18); },
    fanfare: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.25, "triangle")),
  };
  // iOS は最初のタップで AudioContext を起こす必要がある
  window.addEventListener("pointerdown", () => audio(), { once: true });

  // ---------- ほし（ごほうびポイント） ----------
  const STARS_KEY = "eg.stars";
  EG.stars = {
    all() { return safeJSON(localStorage.getItem(STARS_KEY)); },
    get(gameId) { return gameId ? this.all()[gameId] || 0 : Object.values(this.all()).reduce((a, b) => a + b, 0); },
    add(gameId, n = 1) {
      const all = this.all();
      all[gameId] = (all[gameId] || 0) + n;
      safeSet(STARS_KEY, JSON.stringify(all));
      document.querySelectorAll(".eg-stars").forEach((el) => {
        el.querySelector("b").textContent = this.get();
        el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
      });
      return all[gameId];
    },
  };

  // ---------- ヘッダー ----------
  /**
   * ゲーム画面の上部に「おうちボタン・タイトル・ほしの数」を出す
   * @param {{title:string, homeHref?:string, onBack?:Function}} opt
   */
  EG.mountHeader = ({ title, homeHref = "../../index.html", onBack } = {}) => {
    const h = document.createElement("header");
    h.className = "eg-header";
    h.innerHTML = `
      <button class="eg-round-btn" aria-label="もどる">🏠</button>
      <h1></h1>
      <div class="eg-stars" aria-label="ほし">⭐<b>${EG.stars.get()}</b></div>`;
    h.querySelector("h1").textContent = title;
    h.querySelector("button").addEventListener("click", () => {
      EG.sfx.tap();
      if (onBack && onBack() === false) return;
      location.href = homeHref;
    });
    document.body.prepend(h);
    return h;
  };

  // ---------- ブロック描画 ----------
  const COLORS = { a: "var(--block-a)", b: "var(--block-b)", c: "var(--block-c)" };
  /**
   * ブロックを並べる。5こずつで折り返す（10のまとまりが見えやすい）
   * @param {HTMLElement} el
   * @param {Array<{count:number,color?:string,gone?:boolean}>} groups
   * @param {{cols?:number,size?:number,numbers?:boolean,stagger?:number}} opt
   */
  EG.renderBlocks = (el, groups, { cols = 5, size, numbers = false, stagger = 60 } = {}) => {
    el.innerHTML = "";
    el.classList.add("eg-blocks");
    const total = groups.reduce((s, g) => s + g.count, 0);
    const c = Math.min(cols, Math.max(total, 1));
    el.style.gridTemplateColumns = `repeat(${c}, auto)`;
    if (size) el.style.setProperty("--size", size + "px");
    const blocks = [];
    let i = 0;
    for (const g of groups) {
      for (let k = 0; k < g.count; k++) {
        const b = document.createElement("div");
        b.className = "eg-block" + (g.gone ? " gone" : "");
        b.style.setProperty("--c", COLORS[g.color] || g.color || COLORS.a);
        b.style.animationDelay = i * stagger + "ms";
        if (numbers) b.innerHTML = `<span class="num">${i + 1}</span>`;
        el.appendChild(b);
        blocks.push(b);
        i++;
      }
    }
    return blocks;
  };

  /** 画面サイズとブロック数から、ちょうどいいブロックの大きさを決める */
  EG.blockSize = (count, cols = 5, maxW = window.innerWidth * 0.8, maxH = window.innerHeight * 0.32) => {
    const c = Math.min(cols, Math.max(count, 1));
    const r = Math.ceil(count / cols) || 1;
    const s = Math.min(maxW / c - 8, maxH / r - 8, 80);
    return Math.max(18, Math.floor(s));
  };

  // ---------- 紙ふぶき ----------
  EG.confetti = (count = 120) => {
    let cv = document.getElementById("eg-confetti");
    if (!cv) {
      cv = document.createElement("canvas");
      cv.id = "eg-confetti";
      document.body.appendChild(cv);
    }
    const dpr = window.devicePixelRatio || 1;
    cv.width = innerWidth * dpr;
    cv.height = innerHeight * dpr;
    const g = cv.getContext("2d");
    g.scale(dpr, dpr);
    const colors = ["#4f8ff7", "#ff9f43", "#2ecc71", "#ff6fa5", "#ffc93c", "#a66cff"];
    const ps = Array.from({ length: count }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 200,
      y: innerHeight * 0.4,
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 16 - 6,
      r: Math.random() * 6 + 5,
      a: Math.random() * Math.PI,
      va: (Math.random() - 0.5) * 0.4,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    let frame = 0;
    (function loop() {
      g.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of ps) {
        p.vy += 0.45; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
        g.save(); g.translate(p.x, p.y); g.rotate(p.a);
        g.fillStyle = p.c; g.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
        g.restore();
      }
      if (++frame < 150) requestAnimationFrame(loop);
      else g.clearRect(0, 0, innerWidth, innerHeight);
    })();
  };

  // ---------- ごほうび画面 ----------
  EG.showReward = ({ title = "やったね！", emoji = "🏆", onAgain, homeHref = "../../index.html" } = {}) => {
    const d = document.createElement("div");
    d.className = "eg-reward";
    d.innerHTML = `
      <div class="box">
        <div class="big">${emoji}</div>
        <h2></h2>
        <div class="row">
          <button class="eg-btn" data-a="again">🔁 もういちど</button>
          <button class="eg-btn" data-a="home">🏠 おうち</button>
        </div>
      </div>`;
    d.querySelector("h2").textContent = title;
    d.addEventListener("click", (e) => {
      const a = e.target.closest("button")?.dataset.a;
      if (!a) return;
      EG.sfx.tap();
      if (a === "home") location.href = homeHref;
      else { d.remove(); onAgain && onAgain(); }
    });
    document.body.appendChild(d);
    EG.sfx.fanfare();
    EG.confetti(200);
    EG.say("Great job!");
  };

  /** 選択肢ボタンを並べて、正解ならコールバック */
  EG.renderChoices = (el, choices, answer, { label = (v) => v, onCorrect, onWrong } = {}) => {
    el.innerHTML = "";
    el.classList.add("eg-choices");
    let locked = false;
    choices.forEach((v) => {
      const b = document.createElement("button");
      b.className = "eg-btn";
      b.innerHTML = label(v);
      b.addEventListener("click", () => {
        if (locked || b.classList.contains("bad")) return;
        if (v === answer) {
          locked = true;
          b.classList.add("good");
          EG.sfx.correct();
          onCorrect && onCorrect(v, b);
        } else {
          b.classList.add("bad");
          EG.sfx.wrong();
          onWrong && onWrong(v, b);
        }
      });
      el.appendChild(b);
    });
  };

  /** 進み具合の丸 */
  EG.renderProgress = (el, done, total) => {
    el.className = "eg-progress";
    el.innerHTML = Array.from({ length: total }, (_, i) => `<span class="${i < done ? "done" : ""}"></span>`).join("");
  };

  // ---------- オフライン対応 ----------
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    const root = document.currentScript?.src.replace(/shared\/core\.js.*$/, "") || "/";
    window.addEventListener("load", () => navigator.serviceWorker.register(root + "sw.js").catch(() => {}));
  }
})();
