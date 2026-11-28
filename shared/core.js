/*
 * 共通ライブラリ（すべてのゲームで読み込む）
 * window.EG にまとめて生やす。ビルド不要・file:// でも動くように classic script にしている。
 *
 *   EG.numberWord(7)          -> "seven"
 *   EG.say("seven")           -> 英語で読み上げ
 *   EG.say("すごい！", "ja")  -> 日本語で読み上げ
 *   EG.sfx.correct()          -> 効果音
 *   EG.stars.add("counting")  -> いま遊んでいるこどもに ほしを1つ追加
 *   EG.save.get/set(gameId)   -> ゲームごとのセーブデータ（こどもごと・クラウド同期対応）
 *   EG.renderBlocks(el, [{count:3, color:"a"}, {count:2, color:"b"}])
 *   EG.mountHeader({ title, gameId })
 *   EG.showReward({ onAgain, onMenu, menuLabel })
 *   EG.sfx.cheer()            -> 歓声「わーっ！」
 */
(function () {
  "use strict";
  const EG = (window.EG = window.EG || {});
  // このリポジトリのトップ（index.html がある場所）の URL
  EG.ROOT = (document.currentScript && document.currentScript.src.replace(/shared\/core\.js.*$/, "")) || "./";

  // ---------- 画面の大きさ（スクロールなしで1画面に収めるため） ----------
  // 100vh は iPad の Safari でアドレスバーの分ずれるので、実際の高さを CSS 変数 --app-h に入れる
  const setAppHeight = () => document.documentElement.style.setProperty("--app-h", window.innerHeight + "px");
  // 回転した直後は高さがすぐに決まらない（ホーム画面のアプリだと特に遅い）ので、何回か取り直す
  const remeasure = () => { setAppHeight(); [100, 300, 600, 1000].forEach((ms) => setTimeout(setAppHeight, ms)); };
  setAppHeight();
  window.addEventListener("resize", remeasure);
  window.addEventListener("orientationchange", remeasure);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", remeasure);

  // 指でなぞっても画面が動かない（揺れない）ようにする。
  // iPadOS 15 は overscroll-behavior が効かないので、なぞる動きそのものを止める（入力欄・スライダーなどは除く）
  document.addEventListener("touchmove", (e) => {
    if (e.touches && e.touches.length > 1) { e.preventDefault(); return; } // 2本指のズームも止める
    const t = e.target;
    if (t && t.closest && t.closest("textarea, select, input, .eg-scroll")) return;
    e.preventDefault();
  }, { passive: false });
  document.addEventListener("gesturestart", (e) => e.preventDefault());

  const onNextFrame = (fn) => { let q = false; return () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(); }); }; };
  function watchSize(els, fn) {
    if (window.ResizeObserver) { const ro = new ResizeObserver(fn); els.forEach((e) => ro.observe(e)); }
    window.addEventListener("resize", fn);
    window.addEventListener("orientationchange", () => [120, 350, 700, 1100].forEach((ms) => setTimeout(fn, ms)));
  }

  /**
   * 中身を入れ物いっぱいに拡大・縮小する（はみ出さない・スクロールしない）
   *   const stage = EG.fit(document.getElementById("stage"), { max: 3 });
   *   stage.innerHTML = "...";   // ← 返ってきた内側の要素に中身を入れる
   * @param {HTMLElement} box
   * @param {{max?:number, min?:number, fill?:boolean}} opt
   *   max  : 何倍まで大きくするか（1 なら縮めるだけ）
   *   fill : 中身の幅を入れ物の幅にそろえる（折り返しのあるメニューやフォーム向け。高さだけで縮める）
   * @returns {HTMLElement} 中身を入れる内側の要素
   */
  EG.fit = (box, { max = 1, min = 0.25, fill = false } = {}) => {
    box.classList.add("eg-fit");
    if (fill) box.classList.add("fill");
    const inner = document.createElement("div");
    inner.className = "eg-fit-inner";
    while (box.firstChild) inner.appendChild(box.firstChild);
    box.appendChild(inner);
    const update = onNextFrame(() => {
      const cw = box.clientWidth, ch = box.clientHeight;
      const iw = inner.offsetWidth, ih = inner.offsetHeight;
      if (!cw || !ch || !iw || !ih) return;
      const sc = Math.max(min, Math.min(max, cw / iw, ch / ih));
      inner.style.transform = "scale(" + sc.toFixed(4) + ")";
    });
    watchSize([box, inner], update);
    if (window.MutationObserver) new MutationObserver(update).observe(inner, { childList: true, subtree: true, characterData: true });
    inner.refit = update;
    update();
    return inner;
  };

  /**
   * いくつかのカードを、スクロールせずに いちばん大きく並べる（列の数を自動で決める）
   * 入れ物に CSS 変数 --cell（カードの幅）と --cols を入れる
   * @param {HTMLElement} box
   * @param {() => number} count  カードの数
   * @param {{gap?:number, ratio?:number, max?:number}} opt  ratio = 高さ / 幅
   */
  EG.gridFit = (box, count, { gap = 24, ratio = 1, max = 320 } = {}) => {
    const update = onNextFrame(() => {
      const n = Math.max(1, count());
      const cs = getComputedStyle(box);
      const W = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const H = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const g = parseFloat(cs.columnGap) || gap;
      if (W <= 0 || H <= 0) return;
      let best = { size: 0, cols: 1 };
      for (let c = 1; c <= n; c++) {
        const r = Math.ceil(n / c);
        const size = Math.min((W - g * (c - 1)) / c, (H - g * (r - 1)) / r / ratio, max);
        if (size > best.size) best = { size, cols: c };
      }
      box.style.setProperty("--cell", Math.floor(best.size) + "px");
      box.style.setProperty("--cols", best.cols);
    });
    watchSize([box], update);
    return update;
  };

  /** <dialog> を開く・閉じる（古い Safari では代わりの表示にする） */
  EG.openDialog = (dlg) => {
    if (dlg.open) return;
    if (typeof dlg.showModal === "function") return dlg.showModal();
    dlg.classList.add("eg-dialog-fallback");
    dlg.setAttribute("open", "");
    const bd = document.createElement("div");
    bd.className = "eg-dialog-backdrop";
    dlg._bd = bd;
    dlg.before(bd);
  };
  EG.closeDialog = (dlg) => {
    if (typeof dlg.close === "function" && typeof dlg.showModal === "function") return dlg.close();
    dlg.removeAttribute("open");
    if (dlg._bd) { dlg._bd.remove(); dlg._bd = null; }
  };

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
    // 大きい数のときは「10ちがい」と「1ちがい」をまぜる（位の練習）
    const near = max > 20
      ? EG.shuffle([EG.shuffle([10, -10])[0], EG.shuffle([1, -1])[0]]).concat(EG.shuffle([-10, 10, 2, -2, 1, -1, 11, -11, 9, -9]))
      : EG.shuffle([-2, -1, 1, 2, 3, -3, 10, -10]);
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
  const SETTINGS_VERSION = 2; // 標準の速さを変えたときに上げる（古い保存値をリセット）
  // rate: 英語の読み上げ速度（1 = 標準）。幼児向けにゆっくりめ
  // voiceURI: 「おうちのかたへ」で選んだ英語の声（空ならおすすめを自動で選ぶ）
  const defaults = { v: SETTINGS_VERSION, sound: true, cheer: true, voice: true, rate: 0.75, voiceURI: "" };
  const stored = safeJSON(localStorage.getItem(SETTINGS_KEY));
  if (stored.v !== SETTINGS_VERSION) delete stored.rate;
  EG.settings = Object.assign({}, defaults, stored, { v: SETTINGS_VERSION });
  EG.saveSettings = () => safeSet(SETTINGS_KEY, JSON.stringify(EG.settings));

  function safeJSON(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* プライベートモード等 */ } }

  // ---------- 読み上げ（Web Speech API） ----------
  // 端末の声の一覧はあとから非同期で届くことがある（Safari / Chrome）。
  // 届く前に読み上げると英語の声が選ばれず、日本語の声で英語を読んでしまうので、待ってから選ぶ。
  const hasSpeech = "speechSynthesis" in window;
  let voices = [];
  const loadVoices = () => { try { voices = speechSynthesis.getVoices() || []; } catch { voices = []; } return voices; };
  EG.voicesReady = new Promise((resolve) => {
    if (!hasSpeech || loadVoices().length) return resolve();
    const done = () => { loadVoices(); resolve(); };
    speechSynthesis.addEventListener?.("voiceschanged", done, { once: true });
    setTimeout(done, 2000);
  });
  if (hasSpeech) speechSynthesis.addEventListener?.("voiceschanged", loadVoices);

  const normLang = (v) => (v.lang || "").replace("_", "-").toLowerCase();
  // Apple のおもしろ音声・古い合成音声は子どもの耳に向かないので避ける
  const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley/i;
  const QUALITY = /premium|enhanced|natural|neural|online/i;
  const FAVORITE = /samantha|ava|allison|susan|zoe|nicky|evan|google us english|google uk english female|aria|jenny|guy|libby|sonia/i;

  function scoreEnVoice(v) {
    const lang = normLang(v);
    if (!lang.startsWith("en")) return -Infinity;
    let s = 0;
    if (lang === "en-us") s += 30;
    else if (lang === "en-gb" || lang === "en-au" || lang === "en-ca") s += 20;
    else s += 5; // en-IN など
    if (QUALITY.test(v.name)) s += 25;
    if (FAVORITE.test(v.name)) s += 20;
    if (NOVELTY.test(v.name)) s -= 100;
    return s;
  }
  /** 英語の声の一覧（よい順） */
  EG.englishVoices = () =>
    loadVoices().filter((v) => normLang(v).startsWith("en") && scoreEnVoice(v) > -50)
      .sort((a, b) => scoreEnVoice(b) - scoreEnVoice(a));

  function pickVoice(lang) {
    if (lang === "ja") {
      const ja = voices.filter((v) => normLang(v).startsWith("ja"));
      return ja.find((v) => QUALITY.test(v.name)) || ja[0] || null;
    }
    if (EG.settings.voiceURI) {
      const chosen = voices.find((v) => v.voiceURI === EG.settings.voiceURI);
      if (chosen) return chosen;
    }
    return EG.englishVoices()[0] || null; // 英語の声がなければ null（日本語の声にはしない）
  }

  /**
   * 読み上げ。終わったら resolve する Promise を返す
   * @param {string} text
   * @param {"en"|"ja"} lang
   * @param {{speed?:number, interrupt?:boolean}} opt  speed は設定の速さに掛ける倍率
   */
  EG.say = async (text, lang = "en", { speed = 1, interrupt = true } = {}) => {
    if (!EG.settings.voice || !hasSpeech) return;
    await EG.voicesReady;
    return new Promise((resolve) => {
      try {
        if (interrupt) speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const v = pickVoice(lang);
        if (v) u.voice = v;
        u.lang = v ? v.lang : lang === "ja" ? "ja-JP" : "en-US";
        u.rate = Math.min(1.5, Math.max(0.4, EG.settings.rate * speed));
        u.pitch = 1;
        let done = false;
        const fin = () => { if (!done) { done = true; resolve(); } };
        u.onend = fin;
        u.onerror = fin;
        setTimeout(fin, (1500 + text.length * 120) / u.rate); // 端末によって onend が来ない対策
        speechSynthesis.speak(u);
      } catch { resolve(); }
    });
  };
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
    /** 歓声「わーっ！」（big = true でごほうび用の長い歓声＋拍手） */
    cheer: (big = false) => {
      const c = audio();
      if (!c || !EG.settings.sound || !EG.settings.cheer) return;
      EG.makeCheer(c, c.destination, c.currentTime + 0.02, big);
    },
  };

  /**
   * 歓声を合成する（音声ファイルなし）。たくさんの人が「わーっ！」と言う声＋拍手。
   *  - 1人ぶんの声 = のこぎり波（声の高さ）→ 母音「あ」の響き（フォルマント）を通す
   *  - 「わ」：はじめは口をすぼめた響き（う）から「あ」に開いていく
   *  - 人数ぶん 高さ・始まり・ゆれ をばらばらにして重ねる
   * OfflineAudioContext でも動くように、ctx と出力先を受けとる
   */
  EG.makeCheer = (c, dest, t0, big = false) => {
    const voices = big ? 14 : 9;
    const dur = big ? 2.0 : 1.05;
    const master = c.createGain();
    master.gain.value = big ? 0.8 : 0.68;
    const comp = c.createDynamicsCompressor();
    master.connect(comp).connect(dest);
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < voices; i++) {
      const st = t0 + rnd(0, 0.12);
      const end = st + dur * rnd(0.8, 1.05);
      const f0 = i % 3 === 0 ? rnd(170, 260) : rnd(280, 480); // おとな と こども の声
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f0 * 0.92, st);
      o.frequency.linearRampToValueAtTime(f0 * 1.12, st + 0.18); // 「わー」で声が上がる
      o.frequency.linearRampToValueAtTime(f0 * 0.95, end);
      const lfo = c.createOscillator(); // 声のゆれ
      lfo.frequency.value = rnd(4.5, 7);
      const lg = c.createGain(); lg.gain.value = f0 * 0.025;
      lfo.connect(lg).connect(o.frequency);
      const vg = c.createGain();
      vg.gain.setValueAtTime(0, st);
      vg.gain.linearRampToValueAtTime(rnd(0.5, 1) / voices, st + 0.09);
      vg.gain.setValueAtTime(rnd(0.5, 1) / voices, end - 0.35);
      vg.gain.exponentialRampToValueAtTime(0.0001, end);
      o.connect(vg);
      // 母音のフォルマント（う → あ）
      [[320, 800, 9, 1], [700, 1250, 10, 0.7], [2300, 2600, 12, 0.25]].forEach(([fa, fb, q, amp]) => {
        const bp = c.createBiquadFilter();
        bp.type = "bandpass"; bp.Q.value = q;
        bp.frequency.setValueAtTime(fa, st);
        bp.frequency.linearRampToValueAtTime(fb, st + 0.12);
        const ag = c.createGain(); ag.gain.value = amp * 3;
        vg.connect(bp).connect(ag).connect(master);
      });
      o.start(st); lfo.start(st); o.stop(end + 0.05); lfo.stop(end + 0.05);
    }
    // 息の音（ザーッ）
    const len = Math.floor(c.sampleRate * (dur + 0.2));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const ns = c.createBufferSource(); ns.buffer = buf;
    const nf = c.createBiquadFilter(); nf.type = "bandpass"; nf.frequency.value = 1400; nf.Q.value = 0.8;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0, t0); ng.gain.linearRampToValueAtTime(0.05, t0 + 0.1); ng.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    ns.connect(nf).connect(ng).connect(master);
    ns.start(t0); ns.stop(t0 + dur + 0.1);
    // 拍手（ごほうびのとき）
    if (big) {
      for (let i = 0; i < 46; i++) {
        const ct = t0 + 0.15 + Math.random() * (dur + 0.4);
        const src = c.createBufferSource(); src.buffer = buf;
        const hp = c.createBiquadFilter(); hp.type = "bandpass"; hp.frequency.value = rnd(900, 2200); hp.Q.value = 1.2;
        const g = c.createGain();
        g.gain.setValueAtTime(0, ct); g.gain.linearRampToValueAtTime(rnd(0.15, 0.3), ct + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, ct + 0.06);
        src.connect(hp).connect(g).connect(master);
        src.start(ct, Math.random() * 0.5); src.stop(ct + 0.08);
      }
    }
  };
  // iOS は最初のタップで AudioContext を起こす必要がある
  // iOS は最初のタップで読み上げも起こしておく（無音の発話）
  window.addEventListener("pointerdown", () => {
    audio();
    if (hasSpeech) { try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } catch { /* noop */ } }
  }, { once: true });

  // ---------- データ（モード・こども・ほし・セーブ） ----------
  // ゲーム側は EG.stars / EG.save だけ使えばよい。ゲスト（端末内）かクラウドかは気にしなくてよい。
  //
  // localStorage
  //   eg.mode     : "guest" | "cloud"（未設定なら最初の画面）
  //   eg.profiles : { pid: { name, icon, color, createdAt, updatedAt } }  こども一覧
  //   eg.deleted  : { pid: 消した時刻 }  消したこども（クラウドでほかの端末に伝える）
  //   eg.local    : { profiles: { pid: { stars: { gameId: n }, games: { gameId: { d: データ, t: 時刻 } } } } }
  //                 この端末で遊んだぶん
  //   eg.remote   : { pid: { stars: {...}, games: {...} } }  ほかの端末のぶん（cloud.js が合計して書く）
  // sessionStorage
  //   eg.current  : いま遊んでいるこども（アプリを開くたびに「だれが あそぶ？」で選ぶ）
  const K = { mode: "eg.mode", profiles: "eg.profiles", deleted: "eg.deleted", local: "eg.local", remote: "eg.remote", current: "eg.current", hiddenAt: "eg.hiddenAt" };
  EG.KEYS = K;
  EG.SCHEMA_VERSION = 1;
  const getJ = (k) => safeJSON(localStorage.getItem(k));
  const putJ = (k, v) => safeSet(k, JSON.stringify(v));
  const ss = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* noop */ } },
    del: (k) => { try { sessionStorage.removeItem(k); } catch { /* noop */ } },
  };
  EG.storage = { getJ, putJ, safeJSON };
  /** 画面の更新用（hub が聞く） */
  const changed = (what) => window.dispatchEvent(new CustomEvent("eg:data", { detail: { what } }));
  /** 端末のデータが変わった（cloud.js が聞いて送る） */
  const dirty = () => window.dispatchEvent(new Event("eg:dirty"));
  EG.randomId = (n = 12, chars = "abcdefghijkmnpqrstuvwxyz23456789") => {
    const buf = new Uint32Array(n);
    crypto.getRandomValues(buf);
    return Array.from(buf, (x) => chars[x % chars.length]).join("");
  };

  EG.mode = {
    get: () => { try { return localStorage.getItem(K.mode) || ""; } catch { return ""; } },
    set(m) {
      safeSet(K.mode, m);
      // ブラウザに「消さないで」とお願いする（対応ブラウザのみ）
      try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* noop */ }
      changed("mode");
    },
  };

  EG.profiles = {
    all() { return getJ(K.profiles); },
    list() {
      return Object.entries(this.all()).map(([id, p]) => Object.assign({ id }, p))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    },
    get(id) { const p = this.all()[id]; return p ? Object.assign({ id }, p) : null; },
    current() { return this.get(ss.get(K.current)); },
    select(id) { ss.set(K.current, id); changed("current"); },
    unselect() { ss.del(K.current); changed("current"); },
    create({ name, icon, color }) {
      const all = this.all();
      const id = "p" + EG.randomId(10);
      const now = Date.now();
      all[id] = { name: String(name).slice(0, 10), icon, color, createdAt: now, updatedAt: now };
      putJ(K.profiles, all);
      migrateLegacyStars(id);
      changed("profiles"); dirty();
      return id;
    },
    update(id, patch) {
      const all = this.all();
      if (!all[id]) return;
      Object.assign(all[id], patch, { updatedAt: Date.now() });
      putJ(K.profiles, all);
      changed("profiles"); dirty();
    },
    /** こどもを消す（ほし・進み具合も）。クラウドではほかの端末にも伝わる */
    remove(id) {
      const all = this.all(); delete all[id]; putJ(K.profiles, all);
      const del = getJ(K.deleted); del[id] = Date.now(); putJ(K.deleted, del);
      const L = getJ(K.local); if (L.profiles) delete L.profiles[id]; putJ(K.local, L);
      const R = getJ(K.remote); delete R[id]; putJ(K.remote, R);
      if (ss.get(K.current) === id) ss.del(K.current);
      changed("profiles"); dirty();
    },
  };

  // 旧バージョン（こども機能より前）の ほし を、最初に作ったこどもに引きつぐ
  function migrateLegacyStars(pid) {
    const old = localStorage.getItem("eg.stars");
    if (old === null) return;
    const L = getJ(K.local);
    L.profiles = L.profiles || {};
    L.profiles[pid] = L.profiles[pid] || { stars: {}, games: {} };
    for (const [g, n] of Object.entries(safeJSON(old))) L.profiles[pid].stars[g] = (L.profiles[pid].stars[g] || 0) + (+n || 0);
    putJ(K.local, L);
    ["eg.stars", "eg.stars.others", "eg.cloud"].forEach((k) => { try { localStorage.removeItem(k); } catch { /* noop */ } });
  }

  const curId = () => { const p = EG.profiles.current(); return p ? p.id : null; };
  function localOf(pid, L = getJ(K.local)) {
    L.profiles = L.profiles || {};
    const P = (L.profiles[pid] = L.profiles[pid] || {});
    P.stars = P.stars || {};
    P.games = P.games || {};
    return { L, P };
  }

  EG.stars = {
    /** こどもの ゲームごとの ほし（この端末＋ほかの端末の合計） */
    all(pid = curId()) {
      if (!pid) return {};
      const sum = Object.assign({}, (getJ(K.local).profiles || {})[pid]?.stars);
      for (const [g, n] of Object.entries(getJ(K.remote)[pid]?.stars || {})) sum[g] = (sum[g] || 0) + (+n || 0);
      return sum;
    },
    get(gameId, pid = curId()) {
      const a = this.all(pid);
      return gameId ? a[gameId] || 0 : Object.values(a).reduce((x, y) => x + y, 0);
    },
    add(gameId, n = 1) {
      const pid = curId();
      if (!pid) return 0;
      const { L, P } = localOf(pid);
      P.stars[gameId] = (P.stars[gameId] || 0) + n;
      putJ(K.local, L);
      this.refresh(true);
      dirty();
      return this.get(gameId);
    },
    /** ほしを 0 にする。pid を省略すると全員。クラウドではほかの端末にも伝わる */
    reset(pid) {
      const ids = pid ? [pid] : Object.keys(EG.profiles.all());
      const L = getJ(K.local), R = getJ(K.remote);
      for (const id of ids) {
        if (L.profiles && L.profiles[id]) L.profiles[id].stars = {};
        if (R[id]) R[id].stars = {};
      }
      putJ(K.local, L); putJ(K.remote, R);
      this.refresh(false);
      window.dispatchEvent(new CustomEvent("eg:reset", { detail: { pids: ids } }));
    },
    /** 画面のほしの数を更新 */
    refresh(bump) {
      document.querySelectorAll(".eg-stars b").forEach((b) => {
        b.textContent = this.get();
        if (bump) { const el = b.parentElement; el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
      });
      changed("stars");
    },
  };

  /**
   * ゲームごとの自由なセーブデータ（レベル・ベスト記録など。小さな JSON にする）
   *   EG.save.set("clock", { level: 3 });  EG.save.get("clock") -> { level: 3 } | null
   * 端末ごとに違うときは、あたらしく保存した方を使う
   */
  EG.save = {
    get(gameId, pid = curId()) {
      if (!pid) return null;
      const a = (getJ(K.local).profiles || {})[pid]?.games?.[gameId];
      const b = getJ(K.remote)[pid]?.games?.[gameId];
      const best = !a ? b : !b ? a : (b.t > a.t ? b : a);
      return best ? best.d : null;
    },
    set(gameId, data) {
      const pid = curId();
      if (!pid) return;
      const { L, P } = localOf(pid);
      P.games[gameId] = { d: data, t: Date.now() };
      putJ(K.local, L);
      dirty();
    },
  };

  /** この端末のデータをぜんぶ消す（設定・ログイン・こども・キャッシュ） */
  EG.wipeLocal = async () => {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith("eg.")).forEach((k) => localStorage.removeItem(k));
    } catch { /* noop */ }
    try { sessionStorage.clear(); } catch { /* noop */ }
    try { if (window.caches) for (const k of await caches.keys()) await caches.delete(k); } catch { /* noop */ }
  };

  // しばらく（30分）アプリを離れていたら、次は「だれが あそぶ？」から
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") ss.set(K.hiddenAt, String(Date.now()));
    else {
      const t = +ss.get(K.hiddenAt) || 0;
      if (t && Date.now() - t > 30 * 60 * 1000 && EG.profiles.current()) {
        EG.profiles.unselect();
        if (!EG.isHub) location.href = EG.ROOT + "index.html";
      }
    }
  });

  // ---------- おとなロック（長押しで開く） ----------
  /**
   * @param {HTMLElement} el   長押しするボタン
   * @param {Function} onUnlock
   * @param {number} ms
   */
  EG.adultLock = (el, onUnlock, ms = 3000) => {
    let timer = null, start = 0, raf = 0;
    el.classList.add("eg-lock");
    const stop = () => { clearTimeout(timer); cancelAnimationFrame(raf); timer = null; el.style.setProperty("--p", 0); el.classList.remove("holding"); };
    const tick = () => { el.style.setProperty("--p", Math.min(1, (Date.now() - start) / ms)); raf = requestAnimationFrame(tick); };
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      start = Date.now();
      el.classList.add("holding");
      tick();
      timer = setTimeout(() => { stop(); EG.sfx.correct(); onUnlock(); }, ms);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => el.addEventListener(ev, () => {
      if (!timer) return;
      const short = Date.now() - start < 600;
      stop();
      if (short) EG.toast("おとなの ひとは 3びょう ながおし してね");
    }));
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  };

  EG.toast = (msg, ms = 2200) => {
    let t = document.getElementById("eg-toast");
    if (!t) { t = document.createElement("div"); t.id = "eg-toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove("show"), ms);
  };

  // ---------- ヘッダー ----------
  /**
   * ゲーム画面の上部に「おうちボタン・タイトル・ほしの数」を出す
   * @param {{title:string, homeHref?:string, onBack?:Function}} opt
   */
  EG.mountHeader = ({ title, homeHref = "../../index.html", onBack } = {}) => {
    // 「だれが あそぶ？」を通っていなければトップへ
    const kid = EG.profiles.current();
    if (!EG.mode.get() || !kid) { location.replace(homeHref); return null; }
    const h = document.createElement("header");
    h.className = "eg-header";
    h.innerHTML = `
      <button class="eg-round-btn" aria-label="もどる">🏠</button>
      <h1></h1>
      <div class="eg-kid" title=""><span class="ic"></span></div>
      <div class="eg-stars" aria-label="ほし">⭐<b>${EG.stars.get()}</b></div>`;
    h.querySelector("h1").textContent = title;
    const chip = h.querySelector(".eg-kid");
    chip.style.setProperty("--kc", kid.color);
    chip.querySelector(".ic").textContent = kid.icon;
    chip.title = kid.name;
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

  /**
   * 大きい数（21〜100）を「10のぼう」＋「ばら」で並べる
   *   EG.renderTens(el, EG.tensOf(43, "a"))           -> ぼう4本＋ばら3こ
   *   EG.renderTens(el, { rods: [...], ones: [...] })  -> 色を混ぜたいとき（ぼう1本 = 色10こ の配列）
   * @returns {{rods: HTMLElement[], ones: HTMLElement[], wrap: HTMLElement}}
   */
  EG.tensOf = (n, color = "a") => ({
    rods: Array.from({ length: Math.floor(n / 10) }, () => Array(10).fill(color)),
    ones: Array(n % 10).fill(color),
  });
  EG.renderTens = (el, { rods = [], ones = [] }, { size = 30, stagger = 40 } = {}) => {
    const wrap = document.createElement("div");
    wrap.className = "eg-tens";
    wrap.style.setProperty("--size", size + "px");
    const mk = (color, i) => {
      const b = document.createElement("div");
      b.className = "eg-block";
      b.style.setProperty("--c", COLORS[color] || color);
      b.style.animationDelay = i * stagger + "ms";
      return b;
    };
    const rodEls = rods.map((cols, r) => {
      const rod = document.createElement("div");
      rod.className = "eg-rod";
      cols.forEach((c) => rod.appendChild(mk(c, r)));
      wrap.appendChild(rod);
      return rod;
    });
    const onesBox = document.createElement("div");
    onesBox.className = "eg-ones";
    const oneEls = ones.map((c, i) => { const b = mk(c, rods.length + i); onesBox.appendChild(b); return b; });
    if (ones.length) wrap.appendChild(onesBox);
    el.appendChild(wrap);
    return { rods: rodEls, ones: oneEls, wrap };
  };

  /** （旧）画面サイズとブロック数から ブロックの大きさを決める。いまは EG.fit を使う */
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
  /**
   * ごほうび画面（5問おわったとき）
   * @param {{title?:string, emoji?:string, onAgain?:Function, onMenu?:Function, menuLabel?:string, homeHref?:string}} opt
   *   onMenu    : 「（ゲーム名）の はじめ」ボタン（レベル・モード選びに戻る）。省略するとボタンを出さない
   *   menuLabel : そのボタンの文字（例「たしざんの はじめ」）
   */
  EG.showReward = ({ title = "やったね！", emoji = "🏆", onAgain, onMenu, menuLabel = "はじめに もどる", homeHref = "../../index.html" } = {}) => {
    const d = document.createElement("div");
    d.className = "eg-reward";
    d.innerHTML = `
      <div class="box">
        <div class="big">${emoji}</div>
        <h2></h2>
        <div class="row">
          <button class="eg-btn" data-a="again"><span class="ic">🔁</span>もういちど</button>
          ${onMenu ? `<button class="eg-btn" data-a="menu"><span class="ic">⬅️</span><span class="lb"></span></button>` : ""}
          <button class="eg-btn" data-a="home"><span class="ic">🏠</span>おうち</button>
        </div>
      </div>`;
    d.querySelector("h2").textContent = title;
    if (onMenu) d.querySelector('[data-a="menu"] .lb').textContent = menuLabel;
    d.addEventListener("click", (e) => {
      const a = e.target.closest("button")?.dataset.a;
      if (!a) return;
      EG.sfx.tap();
      if (a === "home") { location.href = homeHref; return; }
      d.remove();
      if (a === "menu") onMenu && onMenu();
      else onAgain && onAgain();
    });
    document.body.appendChild(d);
    EG.fit(d); // 画面に収める
    EG.sfx.fanfare();
    EG.sfx.cheer(true);
    EG.confetti(200);
    setTimeout(() => EG.say("Great job!"), 900);
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
          EG.sfx.cheer();
          // 歓声のあとに読み上げが始まるよう、少しだけ待つ
          setTimeout(() => onCorrect && onCorrect(v, b), EG.settings.cheer && EG.settings.sound ? 550 : 0);
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
  // 新しい版が届いたら、次に画面が切りかわるときに自動で読みこみ直す
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register(EG.ROOT + "sw.js", { updateViaCache: "none" }).then((reg) => {
        reg.update().catch(() => {});
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
      }).catch(() => {});
      let reloaded = false;
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadController || reloaded || !EG.isHub) return; // ゲームの途中では読みこみ直さない
        reloaded = true;
        location.reload();
      });
    });
  }

  // ---------- クラウド同期（ログインしているときだけ読み込む） ----------
  // ゲーム側は何もしなくてよい（EG.stars / EG.save の変更を cloud.js が自動で送る）。
  function loadScript(src) {
    return new Promise((res, rej) => {
      const el = document.createElement("script");
      el.src = src; el.onload = res; el.onerror = rej;
      document.head.appendChild(el);
    });
  }
  EG.loadScript = loadScript;
  let cloudP = null;
  EG.loadCloud = () => cloudP || (cloudP = loadScript(EG.ROOT + "shared/cloud.js").then(() => EG.cloud).catch(() => { cloudP = null; return null; }));
  EG.cloudReady = EG.mode.get() === "cloud" ? EG.loadCloud() : Promise.resolve(null);
})();
