/*
 * クラウド同期（各家庭が自分で用意した Firebase を使う。SDK なしで REST API を直接呼ぶ）
 *
 * しくみ
 *  - ログインは Firebase の「匿名ログイン」。メール・パスワードは使わない
 *  - 端末ごとに別の匿名アカウントになるので、データは「おうち」単位にまとめる
 *  - おうちには「合言葉」があり、合言葉を知っている端末だけが参加できる（firestore.rules で確認）
 *  - 1台目：firebaseConfig を貼るだけ → おうちを作る
 *  - 2台目以降：QR（設定値＋おうちID＋合言葉）を読むだけ
 *  - 「QR を作り直す」= 合言葉を変える（参加ずみの端末はそのまま）。端末は1台ずつ外せる
 *  - Firebase の設定値・おうちID・合言葉は この端末の localStorage にだけ保存する（公開リポジトリには書かない）
 *
 * Firestore のデータ（ゲームごとの項目はルールに書かない → ゲームが増えても Firebase 側の変更なし）
 *   households/{hid}
 *     key           : 合言葉
 *     members       : { 匿名uid: { deviceId, name, joinedAt } }   参加している端末
 *     joinKey       : 参加するときに送る合言葉（ルールで key と同じか確認するためだけに使う）
 *     schemaVersion : データの形のバージョン
 *     profiles      : { pid: { name, icon, color, createdAt, updatedAt } }   こども一覧
 *     deleted       : { pid: 時刻 }   消したこども
 *     resets        : { pid: 時刻 }   ほしを 0 にした時刻
 *     wipedAt       : クラウドのデータをぜんぶ消した時刻
 *   households/{hid}/devices/{deviceId}
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
  const CK = "eg.cloud"; // { apiKey, projectId, hid, key, uid, idToken, refreshToken, expiresAt, deviceId, deviceName, lastSync, seen, joined }

  let st = getJ(CK);
  const save = () => putJ(CK, st);
  if (!st.deviceId) { st.deviceId = "d" + EG.randomId(12); save(); }
  // メール＋パスワード方式（旧）のログイン情報は使わない
  if (st.email || st.password) { st = { deviceId: st.deviceId }; save(); }

  let error = "";
  let devices = []; // [{ uid, deviceId, name, joinedAt, updatedAt, self }]
  let busy = null, again = false;
  let gen = 0; // おうちに入り直すたびに増やす（古い同期の結果で上書きしないため）
  const emit = () => window.dispatchEvent(new Event("eg:cloud"));
  const OFFLINE = "インターネットに つながりません";
  const KEY_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

  /** 端末の名前（自動） */
  function autoDeviceName() {
    const ua = navigator.userAgent;
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
    if (/iPhone/.test(ua)) return "iPhone";
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android スマホ" : "Android タブレット";
    if (/Macintosh/.test(ua)) return "Mac";
    if (/Windows/.test(ua)) return "Windows";
    return "たんまつ";
  }

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
    if (!st.hid || !st.key) return "";
    const data = { v: 2, k: st.apiKey, p: st.projectId, h: st.hid, s: st.key };
    return EG.ROOT + "index.html#join=" + b64url.enc(JSON.stringify(data));
  }
  function parseQr(text) {
    const m = String(text || "").match(/#join=([A-Za-z0-9_-]+)/) || String(text || "").match(/^([A-Za-z0-9_-]{40,})$/);
    if (!m) throw new Error("この QR は つかえません");
    let d;
    try { d = JSON.parse(b64url.dec(m[1])); } catch { throw new Error("この QR は よみとれませんでした"); }
    if (d.v !== 2 || !d.k || !d.p || !d.h || !d.s) throw new Error("この QR は つかえません（ふるい バージョンの QR かも しれません）");
    return { apiKey: d.k, projectId: d.p, hid: d.h, key: d.s };
  }

  // ---------- 匿名ログイン（Identity Toolkit REST） ----------
  async function authCall(apiKey, path, body, form) {
    const url = (path === "token" ? "https://securetoken.googleapis.com/v1/" : "https://identitytoolkit.googleapis.com/v1/") + path + "?key=" + encodeURIComponent(apiKey);
    let res;
    try {
      res = await fetch(url, form
        ? { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch { throw new Error(OFFLINE); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const raw = String(j.error?.message || "");
      const code = raw.split(" ")[0].split(":")[0];
      let msg = "ログインできませんでした（" + (code || res.status) + "）";
      if (code === "ADMIN_ONLY_OPERATION" || code === "OPERATION_NOT_ALLOWED") msg = "Firebase で「匿名」ログインが有効になっていません";
      else if (/API.?KEY|API key/i.test(raw)) msg = "apiKey が ちがうか、使えない設定に なっています";
      const e = new Error(msg); e.code = code; throw e;
    }
    return j;
  }
  async function signUpAnon(apiKey) {
    const j = await authCall(apiKey, "accounts:signUp", { returnSecureToken: true });
    return { uid: j.localId, idToken: j.idToken, refreshToken: j.refreshToken, expiresAt: Date.now() + (+j.expiresIn) * 1000 };
  }
  async function token() {
    if (!st.apiKey || !st.uid) throw new Error("ログインしていません");
    if (st.idToken && st.expiresAt > Date.now() + 60_000) return st.idToken;
    const myGen = gen;
    const j = await authCall(st.apiKey, "token", { grant_type: "refresh_token", refresh_token: st.refreshToken || "" }, true);
    if (myGen !== gen) throw new Error("ログインし直しました");
    Object.assign(st, { idToken: j.id_token, refreshToken: j.refresh_token, expiresAt: Date.now() + (+j.expires_in) * 1000 });
    save();
    return st.idToken;
  }

  // ---------- Firestore REST ----------
  const docBase = (c) => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(c.projectId)}/databases/(default)/documents/households/${c.hid}`;
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

  class Forbidden extends Error {}
  /**
   * @param {string} method
   * @param {string} path  households/{hid} からの相対パス
   * @param {{body?:object, mask?:string[], query?:string, c?:object, idToken?:string}} opt
   *        c / idToken：まだ保存していないおうち・アカウントで呼ぶとき（作成・参加）
   */
  async function fs(method, path = "", { body, mask, query = "", c = st, idToken } = {}) {
    const t = idToken || (await token());
    let url = docBase(c) + path;
    const qs = [];
    if (mask) mask.forEach((m) => qs.push("updateMask.fieldPaths=" + encodeURIComponent(m)));
    if (query) qs.push(query);
    if (qs.length) url += "?" + qs.join("&");
    let res;
    try {
      res = await fetch(url, { method, headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    } catch { throw new Error(OFFLINE); }
    if (res.status === 404) return null;
    if (res.status === 403) throw new Forbidden("Firestore に アクセスできません");
    if (!res.ok) throw new Error("クラウドに つながりませんでした (" + res.status + ")");
    return res.json();
  }
  const getHousehold = async (opt) => unfields(await fs("GET", "", opt));
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
    const myGen = gen;
    let doc;
    try { doc = await getHousehold(); }
    catch (e) {
      if (e instanceof Forbidden && myGen === gen) return kicked(); // おうちから外された
      throw e;
    }
    if (myGen !== gen) return;
    if (!doc || !doc.members || !doc.members[st.uid]) return kicked();
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

    // 4) ほかの端末のぶんを合計（外した端末の記録も、遊んだぶんとして数える）
    const docs = await listDevices();
    const R = {};
    for (const d of docs) {
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
    putJ(K.remote, R);
    const lastSeen = Object.fromEntries(docs.map((d) => [d.id, d.updatedAt || 0]));
    devices = Object.entries(doc.members).map(([uid, m]) => ({
      uid, deviceId: m.deviceId, name: m.name || "たんまつ", joinedAt: m.joinedAt || 0,
      updatedAt: uid === st.uid ? now : lastSeen[m.deviceId] || 0, self: uid === st.uid,
    })).sort((a, b) => a.joinedAt - b.joinedAt);

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

  /** この端末が おうちから外された → 記録はゲストとして端末に残す */
  function kicked() {
    st = { deviceId: st.deviceId, deviceName: st.deviceName };
    save();
    devices = [];
    putJ(K.remote, {}); putJ(K.deleted, {});
    EG.mode.set("guest");
    error = "";
    emit();
    window.dispatchEvent(new Event("eg:kicked"));
  }

  async function syncNow() {
    if (!st.uid || !st.joined) return;
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

  // ---------- おうちを作る・参加する ----------
  /** 同じ Firebase なら今の匿名アカウントを使い回す */
  async function ensureAuth(c) {
    if (st.uid && st.apiKey === c.apiKey && st.projectId === c.projectId && st.refreshToken) {
      try { await token(); return { uid: st.uid, idToken: st.idToken, refreshToken: st.refreshToken, expiresAt: st.expiresAt }; }
      catch (e) { if (e.message === OFFLINE) throw e; }
    }
    return signUpAnon(c.apiKey);
  }
  const deviceName = () => st.deviceName || autoDeviceName();
  const member = (uid) => ({ [uid]: { deviceId: st.deviceId, name: deviceName(), joinedAt: Date.now() } });
  function adopt(c, auth, doc, sameHousehold) {
    gen++;
    const prev = st;
    st = Object.assign({ deviceId: prev.deviceId, deviceName: deviceName() }, c, auth, {
      joined: true,
      seen: sameHousehold && prev.seen ? prev.seen : { resets: Object.assign({}, doc.resets || {}), wipedAt: doc.wipedAt || 0 },
      lastSync: sameHousehold ? prev.lastSync : 0,
    });
    save();
    error = "";
    emit();
  }

  /** 1台目：おうちを作る */
  async function createHousehold(cfg) {
    const auth = await ensureAuth(cfg);
    const c = Object.assign({}, cfg, { hid: EG.randomId(20), key: EG.randomId(32, KEY_CHARS) });
    const doc = { key: c.key, members: member(auth.uid), schemaVersion: EG.SCHEMA_VERSION, profiles: {}, deleted: {}, resets: {}, wipedAt: 0 };
    try {
      await fs("PATCH", "", { c, idToken: auth.idToken, body: { fields: fields(doc) }, query: "currentDocument.exists=false" });
    } catch (e) {
      throw e instanceof Forbidden ? new Error("Firestore に書きこめません。ルールを はりつけて「公開」したか 確認してください") : e;
    }
    adopt(c, auth, doc, false);
    return { sameAccount: false };
  }

  /** 2台目以降：QR でおうちに参加する */
  async function join(c) {
    const same = st.hid === c.hid && !!st.joined;
    const auth = await ensureAuth(c);
    try {
      await fs("PATCH", "", {
        c, idToken: auth.idToken,
        body: { fields: fields({ members: member(auth.uid), joinKey: c.key }) },
        mask: ["members." + auth.uid, "joinKey"],
      });
    } catch (e) {
      if (e instanceof Forbidden) throw new Error("この QR は つかえません（あたらしい QR に なっているかも しれません）");
      throw e;
    }
    const doc = await getHousehold({ c, idToken: auth.idToken });
    adopt(c, auth, doc, same);
    return { sameAccount: same };
  }
  const joinWithQr = (text) => join(parseQr(text));

  /** QR を作り直す：合言葉を変える（参加ずみの端末はそのまま。古い QR では参加できない） */
  async function regenerate() {
    const key = EG.randomId(32, KEY_CHARS);
    await fs("PATCH", "", { body: { fields: fields({ key }) }, mask: ["key"] });
    st.key = key; save(); emit();
  }

  /** ほかの端末を外す（その端末で遊んだ記録は残る） */
  async function removeDevice(uid) {
    if (uid === st.uid) throw new Error("この たんまつ は ここでは はずせません");
    await fs("PATCH", "", { body: { fields: {} }, mask: ["members." + uid] });
    await syncNow();
  }
  /** 端末の名前を変える */
  async function renameDevice(uid, name) {
    const m = devices.find((d) => d.uid === uid);
    if (!m) return;
    const nm = String(name || "").trim().slice(0, 20) || "たんまつ";
    await fs("PATCH", "", { body: { fields: { members: enc({ [uid]: { deviceId: m.deviceId, name: nm, joinedAt: m.joinedAt } }) } }, mask: ["members." + uid] });
    if (uid === st.uid) { st.deviceName = nm; save(); }
    await syncNow();
  }
  /** この端末が おうちから抜ける（この端末のデータをぜんぶ消す ときに使う） */
  async function leave() {
    if (!st.uid || !st.joined) return;
    try { await fs("PATCH", "", { body: { fields: {} }, mask: ["members." + st.uid] }); } catch { /* オフラインでも消す */ }
  }

  /** クラウドのデータをぜんぶ消す（おうち・参加している端末・合言葉は残る） */
  async function wipeCloud() {
    const docs = await listDevices();
    for (const d of docs) await fs("DELETE", "/devices/" + d.id);
    const now = Date.now();
    await fs("PATCH", "", {
      body: { fields: fields({ schemaVersion: EG.SCHEMA_VERSION, profiles: {}, deleted: {}, resets: {}, wipedAt: now }) },
      mask: ["schemaVersion", "profiles", "deleted", "resets", "wipedAt"],
    });
    st.seen = { resets: {}, wipedAt: now };
    save();
    putJ(K.profiles, {}); putJ(K.deleted, {}); putJ(K.local, {}); putJ(K.remote, {});
    EG.profiles.unselect();
    emit();
  }

  async function onReset(pids) {
    if (!st.uid || !st.joined) return;
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
    parseConfig, parseQr, createHousehold, join, joinWithQr, regenerate, removeDevice, renameDevice, leave, wipeCloud, syncNow, qrPayload,
    isLoggedIn: () => !!(st.uid && st.joined),
    devices: () => devices.slice(),
    state: () => ({
      loggedIn: !!(st.uid && st.joined), projectId: st.projectId || "", deviceId: st.deviceId, deviceName: deviceName(),
      devices: devices.length || 1, lastSync: st.lastSync || 0, error, busy: !!busy,
    }),
    debug: () => ({ uid: st.uid, deviceId: st.deviceId, projectId: st.projectId, hid: st.hid, lastSync: st.lastSync, seen: st.seen }),
  };

  // ---------- いつ同期するか ----------
  window.addEventListener("eg:dirty", () => syncSoon());
  window.addEventListener("eg:reset", (e) => onReset(e.detail.pids));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncSoon(300); });
  window.addEventListener("online", () => syncSoon(300));
  if (st.uid && st.joined && EG.mode.get() === "cloud") syncSoon(300);
})();
