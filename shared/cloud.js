/*
 * クラウド同期（各家庭が自分で用意した Firebase を使う。SDK なしで REST API を直接呼ぶ）
 *
 * しくみ
 *  - Firebase の設定値（apiKey / projectId）とログイン情報は、この端末の localStorage にだけ保存する
 *    （公開リポジトリには書かない）
 *  - ログインは保護者のアカウント1つ（メール＋パスワード）。Firebase 側で新規登録はオフにしておく
 *  - 2台目以降は QR（設定値＋ログイン情報）を読むだけでログイン
 *  - 「QR を作り直す」= パスワードをランダムに変える → 古い QR とほかの端末のログインは無効になる
 *
 * Firestore のデータ（ルールは「本人の users/{uid} 以下なら何でも可」の1本だけ → ゲームが増えても変更不要）
 *   users/{uid}
 *     schemaVersion : データの形のバージョン
 *     profiles      : { pid: { name, icon, color, createdAt, updatedAt } }   こども一覧
 *     deleted       : { pid: 時刻 }   消したこども
 *     resets        : { pid: 時刻 }   ほしを 0 にした時刻
 *     wipedAt       : クラウドのデータをぜんぶ消した時刻
 *   users/{uid}/devices/{deviceId}
 *     profiles      : { pid: { stars: { gameId: n }, games: { gameId: { d, t } } } }   その端末で遊んだぶん
 *     updatedAt
 *  端末は自分の devices/{deviceId} だけを書くので、同時に遊んでもぶつからない。
 *  表示は「この端末 + ほかの端末」の合計（core.js の EG.stars / EG.save）。
 */
(function () {
  "use strict";
  const EG = window.EG;
  const { getJ, putJ } = EG.storage;
  const K = EG.KEYS;
  const CK = "eg.cloud"; // { apiKey, projectId, email, password, uid, idToken, refreshToken, expiresAt, deviceId, lastSync, seen, needRelogin }

  let st = getJ(CK);
  const save = () => putJ(CK, st);
  if (!st.deviceId) { st.deviceId = "d" + EG.randomId(12); save(); }

  let error = "";
  let devicesCount = 0;
  let gen = 0; // ログインし直すたびに増やす（古い同期の結果で上書きしないため）
  let busy = null, again = false;
  const emit = () => window.dispatchEvent(new Event("eg:cloud"));

  // ---------- Firebase の設定値を読む ----------
  /** コンソールからコピーした firebaseConfig（JS / JSON どちらでも）から apiKey と projectId を取り出す */
  function parseConfig(text) {
    const pick = (k) => {
      const m = String(text || "").match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`));
      return m ? m[1].trim() : "";
    };
    const cfg = { apiKey: pick("apiKey"), projectId: pick("projectId") };
    if (!cfg.apiKey || !cfg.projectId) throw new Error("apiKey と projectId が見つかりません。firebaseConfig を まるごと貼りつけてください");
    return cfg;
  }

  // ---------- QR の中身 ----------
  const b64url = {
    enc: (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    dec: (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))),
  };
  /** 2台目以降に読ませる URL（カメラアプリで読んでも開けるように URL にする。#以降はサーバーに送られない） */
  function qrPayload() {
    if (!st.password) return "";
    const data = { v: 1, k: st.apiKey, p: st.projectId, e: st.email, w: st.password };
    return EG.ROOT + "index.html#join=" + b64url.enc(JSON.stringify(data));
  }
  function parseQr(text) {
    const m = String(text || "").match(/#join=([A-Za-z0-9_-]+)/) || String(text || "").match(/^([A-Za-z0-9_-]{40,})$/);
    if (!m) throw new Error("この QR は つかえません");
    let d;
    try { d = JSON.parse(b64url.dec(m[1])); } catch { throw new Error("この QR は よみとれませんでした"); }
    if (d.v !== 1 || !d.k || !d.p || !d.e || !d.w) throw new Error("この QR は つかえません");
    return { apiKey: d.k, projectId: d.p, email: d.e, password: d.w };
  }

  // ---------- ログイン（Identity Toolkit REST） ----------
  const AUTH_ERRORS = {
    EMAIL_NOT_FOUND: "メールアドレスか パスワードが ちがいます",
    INVALID_PASSWORD: "メールアドレスか パスワードが ちがいます",
    INVALID_LOGIN_CREDENTIALS: "メールアドレスか パスワードが ちがいます",
    INVALID_EMAIL: "メールアドレスの かたちが ちがいます",
    USER_DISABLED: "このアカウントは とめられています",
    OPERATION_NOT_ALLOWED: "Firebase で「メール／パスワード」のログインが有効になっていません",
    TOO_MANY_ATTEMPTS_TRY_LATER: "しっぱいが多すぎます。しばらくしてから もういちど",
    WEAK_PASSWORD: "パスワードが よわすぎます",
  };
  async function authCall(apiKey, path, body, form) {
    const url = (path.startsWith("token") ? "https://securetoken.googleapis.com/v1/" : "https://identitytoolkit.googleapis.com/v1/") + path + "?key=" + encodeURIComponent(apiKey);
    let res;
    try {
      res = await fetch(url, form
        ? { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch { throw new Error("インターネットに つながりません"); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = String(j.error?.message || "").split(" ")[0].split(":")[0];
      const msg = AUTH_ERRORS[code] || (/API.?KEY|API key/i.test(j.error?.message || "") ? "apiKey が ちがいます" : "ログインできませんでした（" + (code || res.status) + "）");
      const e = new Error(msg); e.code = code; throw e;
    }
    return j;
  }
  async function signIn(c) {
    const j = await authCall(c.apiKey, "accounts:signInWithPassword", { email: c.email, password: c.password, returnSecureToken: true });
    return { uid: j.localId, idToken: j.idToken, refreshToken: j.refreshToken, expiresAt: Date.now() + (+j.expiresIn) * 1000 };
  }
  async function token() {
    if (!st.apiKey) throw new Error("ログインしていません");
    const myGen = gen;
    const stale = () => { if (myGen !== gen) throw new Error("ログインし直しました"); };
    if (st.idToken && st.expiresAt > Date.now() + 60_000) return st.idToken;
    try {
      const j = await authCall(st.apiKey, "token", { grant_type: "refresh_token", refresh_token: st.refreshToken || "" }, true);
      stale();
      Object.assign(st, { idToken: j.id_token, refreshToken: j.refresh_token, expiresAt: Date.now() + (+j.expires_in) * 1000 });
    } catch (e) {
      stale();
      if (e.message === "インターネットに つながりません") throw e;
      // トークンが無効（ほかの端末で QR を作り直した等）→ 保存しているパスワードで入り直す
      try {
        const a = await signIn(st);
        stale();
        Object.assign(st, a);
      } catch (e2) {
        stale();
        if (e2.message === "インターネットに つながりません") throw e2;
        st.needRelogin = true; save(); emit();
        throw new Error("QR が あたらしく なりました。おとなメニューから もういちど QR を よみとってください");
      }
    }
    st.needRelogin = false;
    save();
    return st.idToken;
  }

  // ---------- Firestore REST ----------
  const base = () => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(st.projectId)}/databases/(default)/documents/users/${st.uid}`;
  function enc(v) {
    if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === "string") return { stringValue: v };
    if (typeof v === "boolean") return { booleanValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
    if (v && typeof v === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
    return { nullValue: null };
  }
  function dec(v) {
    if (!v) return null;
    if ("integerValue" in v) return +v.integerValue;
    if ("doubleValue" in v) return v.doubleValue;
    if ("stringValue" in v) return v.stringValue;
    if ("booleanValue" in v) return v.booleanValue;
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec);
    if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]));
    return null;
  }
  const fields = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, enc(v)]));
  const unfields = (doc) => Object.fromEntries(Object.entries(doc?.fields || {}).map(([k, v]) => [k, dec(v)]));

  async function fs(method, path = "", { body, mask, query = "" } = {}) {
    const t = await token();
    let url = base() + path;
    const qs = [];
    if (mask) mask.forEach((m) => qs.push("updateMask.fieldPaths=" + encodeURIComponent(m)));
    if (query) qs.push(query);
    if (qs.length) url += "?" + qs.join("&");
    let res;
    try {
      res = await fetch(url, { method, headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    } catch { throw new Error("インターネットに つながりません"); }
    if (res.status === 404) return null;
    if (res.status === 403) throw new Error("Firestore に書きこめません（ルールを確認してください）");
    if (!res.ok) throw new Error("クラウドに つながりませんでした (" + res.status + ")");
    return res.json();
  }
  const getUserDoc = async () => unfields(await fs("GET"));
  async function listDevices() {
    const out = [];
    let pageToken = "";
    do {
      const j = await fs("GET", "/devices", { query: "pageSize=300" + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "") });
      for (const d of (j && j.documents) || []) out.push({ id: d.name.split("/").pop(), ...unfields(d) });
      pageToken = j && j.nextPageToken;
    } while (pageToken);
    return out;
  }

  // ---------- 同期 ----------
  async function syncOnce() {
    const seen = (st.seen = st.seen || { resets: {}, wipedAt: 0 });
    const doc = await getUserDoc();
    const now = Date.now();

    // 1) ほかの端末で「クラウドのデータをぜんぶ消す」が押されていた → この端末のこども・記録も消す
    const wipedAt = doc.wipedAt || 0;
    if (wipedAt > (seen.wipedAt || 0)) {
      seen.wipedAt = wipedAt;
      putJ(K.profiles, {}); putJ(K.deleted, {}); putJ(K.local, {}); putJ(K.remote, {});
      EG.profiles.unselect();
    }

    // 2) こども一覧をまぜる（あたらしく変えた方を使う。消したこどもは消す）
    const deleted = Object.assign({}, doc.deleted || {}, getJ(K.deleted));
    const profiles = Object.assign({}, doc.profiles || {});
    for (const [id, p] of Object.entries(getJ(K.profiles))) {
      if (!profiles[id] || (p.updatedAt || 0) > (profiles[id].updatedAt || 0)) profiles[id] = p;
    }
    for (const id of Object.keys(deleted)) delete profiles[id];
    putJ(K.profiles, profiles);
    putJ(K.deleted, deleted);

    // 3) この端末の記録から、消したこどもを取り除き、ほしのリセットを反映
    const resets = doc.resets || {};
    const L = getJ(K.local);
    L.profiles = L.profiles || {};
    for (const id of Object.keys(L.profiles)) if (!profiles[id]) delete L.profiles[id];
    for (const [id, t] of Object.entries(resets)) {
      if (t > (seen.resets[id] || 0)) {
        seen.resets[id] = t;
        if (L.profiles[id]) L.profiles[id].stars = {};
      }
    }
    putJ(K.local, L);

    // 4) ほかの端末のぶんを合計
    const devices = await listDevices();
    const R = {};
    for (const d of devices) {
      if (d.id === st.deviceId) continue;
      const t = d.updatedAt || 0;
      if (t < wipedAt) continue; // ぜんぶ消す より前の記録は使わない
      for (const [pid, P] of Object.entries(d.profiles || {})) {
        if (!profiles[pid]) continue;
        const r = (R[pid] = R[pid] || { stars: {}, games: {} });
        if (t >= (resets[pid] || 0)) {
          for (const [g, n] of Object.entries(P.stars || {})) r.stars[g] = (r.stars[g] || 0) + (+n || 0);
        }
        for (const [g, s] of Object.entries(P.games || {})) if (!r.games[g] || s.t > r.games[g].t) r.games[g] = s;
      }
    }
    devicesCount = devices.filter((d) => d.id !== st.deviceId && (d.updatedAt || 0) >= wipedAt).length + 1;
    putJ(K.remote, R);

    // 5) 送る（こども一覧と、この端末のぶん）
    await fs("PATCH", "", {
      body: { fields: fields({ schemaVersion: EG.SCHEMA_VERSION, profiles, deleted }) },
      mask: ["schemaVersion", "profiles", "deleted"],
    });
    await fs("PATCH", "/devices/" + st.deviceId, { body: { fields: fields({ profiles: L.profiles, updatedAt: now }) } });

    st.lastSync = Date.now();
    save();
    window.dispatchEvent(new CustomEvent("eg:data", { detail: { what: "sync" } }));
    EG.stars.refresh(false);
  }

  async function syncNow() {
    if (!st.uid) return;
    if (busy) { again = true; return busy; }
    busy = (async () => {
      emit();
      try { await syncOnce(); error = ""; }
      catch (e) { error = navigator.onLine === false ? "オフラインです（つながったら どうきします）" : e.message; }
      finally {
        busy = null;
        emit();
        if (again) { again = false; syncNow(); }
      }
    })();
    return busy;
  }
  let timer;
  const syncSoon = (ms = 2000) => { clearTimeout(timer); timer = setTimeout(syncNow, ms); };

  // ---------- ログイン・ログアウト ----------
  /**
   * ログインする（1台目は入力、2台目以降は QR）
   * @returns {{sameAccount:boolean}}  前と同じアカウントなら true
   */
  async function login(c) {
    const auth = await signIn(c);
    gen++;
    const prevUid = st.uid;
    const prev = st;
    st = Object.assign({ deviceId: prev.deviceId }, c, auth, { seen: prev.uid === auth.uid ? prev.seen : null, needRelogin: false });
    save();
    // Firestore が使えるか確認し、ログインより前のリセット・全消しは この端末に当てはめない
    try {
      const doc = await getUserDoc();
      if (prevUid !== auth.uid) st.seen = { resets: Object.assign({}, doc.resets || {}), wipedAt: doc.wipedAt || 0 };
      save();
    } catch (e) {
      st = prev; save();
      throw e;
    }
    error = "";
    emit();
    return { sameAccount: prevUid === auth.uid };
  }
  const loginWithQr = (text) => login(parseQr(text));

  /** QR を作り直す：パスワードをランダムに変える → 古い QR・ほかの端末のログインは無効 */
  async function regenerate() {
    const fresh = await signIn(st); // パスワード変更には「さっきログインした」トークンが必要
    const password = EG.randomId(28, "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789");
    const j = await authCall(st.apiKey, "accounts:update", { idToken: fresh.idToken, password, returnSecureToken: true });
    Object.assign(st, { password, idToken: j.idToken, refreshToken: j.refreshToken, expiresAt: Date.now() + (+j.expiresIn) * 1000, needRelogin: false });
    save();
    emit();
  }

  /** クラウドのデータをぜんぶ消す（Firebase のアカウント・設定は残る） */
  async function wipeCloud() {
    const devices = await listDevices();
    for (const d of devices) await fs("DELETE", "/devices/" + d.id);
    const now = Date.now();
    // ドキュメントを丸ごと置きかえる（ほかの端末は wipedAt を見て消す）
    await fs("PATCH", "", { body: { fields: fields({ schemaVersion: EG.SCHEMA_VERSION, profiles: {}, deleted: {}, resets: {}, wipedAt: now }) } });
    st.seen = { resets: {}, wipedAt: now };
    save();
    putJ(K.profiles, {}); putJ(K.deleted, {}); putJ(K.local, {}); putJ(K.remote, {});
    EG.profiles.unselect();
    devicesCount = 1;
    emit();
  }

  async function onReset(pids) {
    if (!st.uid) return;
    const now = Date.now();
    try {
      await fs("PATCH", "", {
        body: { fields: { resets: enc(Object.fromEntries(pids.map((id) => [id, now]))) } },
        mask: pids.map((id) => "resets." + id),
      });
      st.seen = st.seen || { resets: {}, wipedAt: 0 };
      pids.forEach((id) => (st.seen.resets[id] = now));
      save();
    } catch (e) { error = e.message; emit(); }
    syncSoon(200);
  }

  EG.cloud = {
    parseConfig, parseQr, login, loginWithQr, regenerate, wipeCloud, syncNow, qrPayload,
    isLoggedIn: () => !!st.uid,
    state: () => ({
      loggedIn: !!st.uid, email: st.email || "", projectId: st.projectId || "", deviceId: st.deviceId,
      devices: devicesCount || 1, lastSync: st.lastSync || 0, error, busy: !!busy, needRelogin: !!st.needRelogin,
    }),
    debug: () => ({ uid: st.uid, deviceId: st.deviceId, projectId: st.projectId, email: st.email, lastSync: st.lastSync, seen: st.seen, needRelogin: !!st.needRelogin }),
  };

  // ---------- いつ同期するか ----------
  window.addEventListener("eg:dirty", () => syncSoon());
  window.addEventListener("eg:reset", (e) => onReset(e.detail.pids));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncSoon(300); });
  window.addEventListener("online", () => syncSoon(300));
  if (st.uid && EG.mode.get() === "cloud") syncSoon(300);
})();
