/*
 * クラウド同期（Firebase の REST API を直接使う。SDK 不要）
 *
 * しくみ
 *  - 「かぞくコード」（推測できない20文字）を1つ作り、同じコードを入れた端末どうしで同期する
 *  - Firestore の families/{かぞくコード} に、端末ごとの ほしの数 を保存する
 *      { devices: { d123abc: { stars: { add: 5, ... }, updatedAt: 1700000000000 }, ... }, resetAt: 0 }
 *  - 端末は自分の devices.<自分のID> だけを書きかえる → 2台で同時に遊んでもデータがぶつからない
 *  - 表示は「自分 + ほかの端末」の合計（core.js の EG.stars）
 *  - 送るのは ほしの数 と 時刻 だけ。名前などの個人情報は送らない
 *  - Firebase の「匿名ログイン」でトークンを取る（アカウント登録はいらない）
 *
 * EG.cloud
 *   .state()          -> { linked, code, devices, lastSync, error }
 *   .create()         -> 新しいかぞくコードを作って同期開始
 *   .join(code)       -> コードを入れて同期開始
 *   .leave()          -> 同期をやめる（この端末のほしは残る）
 *   .syncNow()        -> いますぐ同期
 *   .joinUrl()        -> 別の端末で開くとつながるURL（QRコード用）
 *   イベント "eg:cloud" で状態の変化を知らせる
 */
(function () {
  "use strict";
  const EG = window.EG;
  const CFG = window.EG_CLOUD_CONFIG || {};
  if (!CFG.apiKey || !CFG.projectId) return;

  const KEY = "eg.cloud";
  const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // まぎらわしい 0 O 1 I L は使わない
  const CODE_LEN = 20;
  const FS = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(CFG.projectId)}/databases/(default)/documents`;

  // ---- 保存 ----
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  let st = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* noop */ } };
  if (!st.deviceId) { st.deviceId = "d" + randomString(12, "abcdefghijkmnpqrstuvwxyz23456789"); save(); }

  function randomString(n, chars) {
    const buf = new Uint32Array(n);
    crypto.getRandomValues(buf);
    return Array.from(buf, (x) => chars[x % chars.length]).join("");
  }
  const normalizeCode = (c) => String(c || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  const validCode = (c) => c.length === CODE_LEN && [...c].every((ch) => ALPHABET.includes(ch));
  const formatCode = (c) => c.replace(/(.{4})(?=.)/g, "$1-");

  let error = "";
  let othersCount = 0;
  const emit = () => window.dispatchEvent(new Event("eg:cloud"));

  // ---- 匿名ログイン（Identity Toolkit REST） ----
  async function token() {
    const now = Date.now();
    if (st.idToken && st.expiresAt > now + 60_000) return st.idToken;
    let res;
    if (st.refreshToken) {
      res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${CFG.apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(st.refreshToken),
      });
      if (res.ok) {
        const j = await res.json();
        Object.assign(st, { idToken: j.id_token, refreshToken: j.refresh_token, expiresAt: now + j.expires_in * 1000 });
        save();
        return st.idToken;
      }
    }
    res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${CFG.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    if (!res.ok) throw new Error("ログインできませんでした（Firebase の匿名ログインが有効か確認してください）");
    const j = await res.json();
    Object.assign(st, { idToken: j.idToken, refreshToken: j.refreshToken, expiresAt: now + j.expiresIn * 1000 });
    save();
    return st.idToken;
  }

  // ---- Firestore の値 ⇔ JS の値 ----
  function enc(v) {
    if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === "string") return { stringValue: v };
    if (typeof v === "boolean") return { booleanValue: v };
    if (v && typeof v === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
    return { nullValue: null };
  }
  function dec(v) {
    if (!v) return null;
    if ("integerValue" in v) return +v.integerValue;
    if ("doubleValue" in v) return v.doubleValue;
    if ("stringValue" in v) return v.stringValue;
    if ("booleanValue" in v) return v.booleanValue;
    if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]));
    return null;
  }

  async function api(method, code, { body, mask } = {}) {
    const t = await token();
    let url = `${FS}/families/${code}`;
    if (mask) url += "?" + mask.map((m) => "updateMask.fieldPaths=" + encodeURIComponent(m)).join("&");
    const res = await fetch(url, {
      method,
      headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("クラウドにつながりませんでした (" + res.status + ")");
    return res.json();
  }

  // ---- 同期 ----
  /** 自分のぶんを送る */
  async function push(code = st.code) {
    const mine = { stars: EG.stars.own(), updatedAt: Date.now() };
    await api("PATCH", code, {
      body: { fields: { devices: enc({ [st.deviceId]: mine }) } },
      mask: ["devices." + st.deviceId],
    });
  }
  /**
   * ほかの端末のぶんを受けとる
   * @param {boolean} first  はじめてつなぐとき（それより前のリセットは自分に当てはめない）
   */
  async function pull(code = st.code, first = false) {
    const doc = await api("GET", code);
    if (!doc) return null;
    const devices = dec(doc.fields?.devices) || {};
    // ほかの端末で「ほしを 0 にもどす」が押されていたら、この端末のぶんも 0 にする
    const resetAt = dec(doc.fields?.resetAt) || 0;
    if (first) st.lastResetSeen = resetAt;
    else if (resetAt > (st.lastResetSeen || 0)) {
      st.lastResetSeen = resetAt;
      try { localStorage.setItem("eg.stars", "{}"); } catch { /* noop */ }
    }
    save();
    const others = {};
    for (const [id, d] of Object.entries(devices)) if (id !== st.deviceId) others[id] = (d && d.stars) || {};
    othersCount = Object.keys(others).length;
    EG.stars.setOthers(others);
    return devices;
  }

  let busy = null, again = false;
  async function syncNow() {
    if (!st.code) return;
    if (busy) { again = true; return busy; }
    busy = (async () => {
      try {
        await pull(); // 先に受けとる（ほかの端末のリセットを反映してから送る）
        await push();
        st.lastSync = Date.now();
        save();
        error = "";
      } catch (e) {
        error = navigator.onLine === false ? "オフラインです（つながったら同期します）" : e.message;
      } finally {
        busy = null;
        emit();
        if (again) { again = false; syncNow(); }
      }
    })();
    return busy;
  }

  let timer;
  const syncSoon = (ms = 2000) => { clearTimeout(timer); timer = setTimeout(syncNow, ms); };

  async function create() {
    let code;
    for (let i = 0; i < 5; i++) {
      code = randomString(CODE_LEN, ALPHABET);
      if (!(await api("GET", code))) break; // 万一の重複チェック
    }
    st.lastResetSeen = 0;
    await push(code);
    st.code = code; save();
    await syncNow();
    return code;
  }

  async function join(input) {
    const code = normalizeCode(input);
    if (!validCode(code)) throw new Error("コードが正しくありません（20文字）");
    const devices = await pull(code, true);
    if (!devices) { EG.stars.setOthers({}); throw new Error("そのコードは見つかりませんでした"); }
    st.code = code; save();
    await syncNow();
    return code;
  }

  function leave() {
    delete st.code; delete st.lastSync; save();
    othersCount = 0;
    EG.stars.setOthers({});
    emit();
  }

  /** ほしをリセットしたとき：同期中なら全端末のぶんを消す */
  async function resetAll() {
    if (!st.code) return;
    try {
      const now = Date.now();
      await api("PATCH", st.code, {
        body: { fields: { devices: enc({ [st.deviceId]: { stars: {}, updatedAt: now } }), resetAt: enc(now) } },
        mask: ["devices", "resetAt"],
      });
      st.lastResetSeen = now;
      othersCount = 0;
      st.lastSync = Date.now(); save(); error = "";
    } catch (e) { error = e.message; }
    emit();
  }

  EG.cloud = {
    state: () => ({ linked: !!st.code, code: st.code ? formatCode(st.code) : "", devices: othersCount + 1, lastSync: st.lastSync || 0, error, busy: !!busy }),
    create, join, leave, syncNow,
    joinUrl: () => (st.code ? EG.ROOT + "index.html?join=" + formatCode(st.code) : ""),
  };

  // ---- いつ同期するか ----
  window.addEventListener("eg:stars-added", () => syncSoon());
  window.addEventListener("eg:stars-reset", resetAll);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncSoon(300); });
  window.addEventListener("online", () => syncSoon(300));
  if (st.code) syncSoon(300);

  // ---- QRコード / URL で開いたとき（?join=XXXX-...） ----
  const q = new URLSearchParams(location.search).get("join");
  if (q) {
    history.replaceState(null, "", location.pathname);
    const code = normalizeCode(q);
    if (code !== st.code && confirm("このかぞくコードで クラウドどうき をはじめますか？\n" + formatCode(code))) {
      join(code).then(() => alert("つながりました！")).catch((e) => alert(e.message));
    }
  }
})();
