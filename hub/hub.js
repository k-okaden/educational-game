/*
 * トップ画面（ハブ）
 *  はじめて → ゲスト／ログイン → だれが あそぶ？（毎回）→ ゲーム一覧
 *  ⚙️ を3秒長押し → おとなメニュー（おと・こども・クラウド・デバッグ）
 */
(function () {
  "use strict";
  EG.isHub = true;
  const $ = (id) => document.getElementById(id);
  const { getJ, putJ } = EG.storage;
  const K = EG.KEYS;

  const ICONS = ["🐶", "🐱", "🐰", "🐻", "🐼", "🐨", "🦁", "🐯", "🐸", "🐵", "🐧", "🐤", "🦊", "🐮", "🐷", "🐙", "🦄", "🦖", "🐳", "🐞", "🌻", "🍓", "🚀", "⭐"];
  const COLORS = ["#4f8ff7", "#ff9f43", "#2ecc71", "#ff6fa5", "#a66cff", "#ffc93c", "#1abc9c", "#ff6b6b"];

  // ---------- 画面の切りかえ ----------
  let cur = "";
  const stack = [];
  function show(id) {
    if (cur === "scan" && id !== "scan") stopScan();
    document.querySelectorAll(".scr").forEach((s) => (s.hidden = s.id !== "scr-" + id));
    cur = id;
    window.scrollTo(0, 0);
  }
  /** 「もどる」で戻れるように進む */
  function go(id) { if (cur) stack.push(cur); show(id); enter(id); }
  function back() { const id = stack.pop(); if (id) { show(id); enter(id); } else route(); }
  document.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => { EG.sfx.tap(); back(); }));

  /** いまの状態から、出す画面を決める */
  function route() {
    stack.length = 0;
    if (!EG.mode.get()) { show("welcome"); return; }
    if (!EG.profiles.current()) {
      if (!EG.profiles.list().length) { show("newkid"); enter("newkid"); return; }
      show("who"); enter("who"); return;
    }
    show("games"); enter("games");
  }
  function enter(id) {
    if (id === "who") renderWho();
    if (id === "games") renderGames();
    if (id === "newkid") resetKidForm();
    if (id === "setup") $("f-err").textContent = "";
  }

  // ---------- ① はじめて ----------
  $("w-guest").onclick = () => { EG.sfx.tap(); EG.mode.set("guest"); route(); };
  $("w-login").onclick = () => { EG.sfx.tap(); go("login"); };

  // ---------- ② ログイン ----------
  $("l-scan").onclick = () => { EG.sfx.tap(); startScan(); };
  $("l-setup").onclick = () => { EG.sfx.tap(); go("setup"); };

  /** ログインしたあとの共通処理（この端末のこどもを引きつぐか聞く） */
  async function afterLogin(cloud, loginFn) {
    const hadKids = EG.profiles.list().length;
    const res = await loginFn();
    if (!res.sameAccount) {
      putJ(K.remote, {});
      if (hadKids && !confirm(`この たんまつの こども（${hadKids}にん）を クラウドに ひきつぎますか？\n\n「キャンセル」を おすと、この たんまつの きろくは けして、クラウドの きろくを つかいます。`)) {
        putJ(K.profiles, {}); putJ(K.local, {}); putJ(K.deleted, {});
        EG.profiles.unselect();
      }
    }
    EG.mode.set("cloud");
    await cloud.syncNow();
    EG.toast("ログインしました");
    route();
  }

  // ---------- ③ QR 読み取り ----------
  let stream = null, scanTimer = 0, detector = null, scanning = false;
  async function startScan() {
    go("scan");
    const msg = $("scan-msg");
    msg.textContent = "1だいめの「おとなメニュー → 2だいめを つなぐ」の QR を うつしてください";
    const video = $("scan-video");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    } catch {
      msg.textContent = "カメラが つかえません。ブラウザの せっていで カメラを きょかしてください。";
      return;
    }
    video.srcObject = stream;
    try { await video.play(); } catch { /* noop */ }
    detector = null;
    try {
      if ("BarcodeDetector" in window && (await BarcodeDetector.getSupportedFormats()).includes("qr_code")) detector = new BarcodeDetector({ formats: ["qr_code"] });
    } catch { /* noop */ }
    if (!detector && !window.jsQR) await EG.loadScript("shared/vendor/jsQR.js");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    scanning = true;
    const tick = async () => {
      if (!scanning) return;
      let text = null;
      if (video.readyState >= 2) {
        if (detector) {
          const r = await detector.detect(video).catch(() => []);
          text = r[0] && r[0].rawValue;
        } else {
          const s = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * s);
          canvas.height = Math.round(video.videoHeight * s);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const r = window.jsQR(img.data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });
          text = r && r.data;
        }
      }
      if (text && scanning) {
        stopScan();
        EG.sfx.correct();
        msg.textContent = "ログインしています…";
        try {
          const cloud = await EG.loadCloud();
          const c = cloud.parseQr(text);
          await afterLogin(cloud, () => cloud.login(c));
        } catch (e) {
          msg.textContent = e.message;
          EG.sfx.wrong();
          setTimeout(() => { if (cur === "scan") startScanAgain(); }, 2500);
        }
        return;
      }
      scanTimer = setTimeout(tick, 150);
    };
    tick();
  }
  function startScanAgain() { stack.pop(); startScan(); }
  function stopScan() {
    scanning = false;
    clearTimeout(scanTimer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  // カメラアプリで QR を読んで開いたとき（#join=...）
  async function handleJoinHash() {
    if (!location.hash.startsWith("#join=")) return false;
    const text = location.href;
    history.replaceState(null, "", location.pathname + location.search); // 履歴に残さない
    try {
      const cloud = await EG.loadCloud();
      const c = cloud.parseQr(text);
      if (!confirm("この QR で ログインしますか？\n" + c.email)) return false;
      await afterLogin(cloud, () => cloud.login(c));
      return true;
    } catch (e) { alert(e.message); return false; }
  }

  // ---------- ④ Firebase 設定（1台目） ----------
  $("setup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("f-submit");
    $("f-err").textContent = "";
    btn.disabled = true; btn.textContent = "ログインしています…";
    try {
      const cloud = await EG.loadCloud();
      if (!cloud) throw new Error("よみこみに しっぱいしました");
      const cfg = cloud.parseConfig($("f-config").value);
      const email = $("f-email").value.trim(), password = $("f-pass").value;
      if (!email || !password) throw new Error("メールアドレスと パスワードを 入れてください");
      await afterLogin(cloud, () => cloud.login(Object.assign(cfg, { email, password })));
      $("f-pass").value = "";
    } catch (err) {
      $("f-err").textContent = err.message;
    } finally {
      btn.disabled = false; btn.textContent = "ログイン";
    }
  });

  // ---------- ⑤ だれが あそぶ？ ----------
  function renderWho() {
    const box = $("kids");
    box.innerHTML = "";
    EG.profiles.list().forEach((p, i) => {
      const b = document.createElement("button");
      b.className = "kid";
      b.style.animationDelay = i * 80 + "ms";
      b.style.setProperty("--kc", p.color);
      b.innerHTML = `<span class="face"></span><b></b><small>⭐ ${EG.stars.get(null, p.id)}</small>`;
      b.querySelector(".face").textContent = p.icon;
      b.querySelector("b").textContent = p.name;
      b.onclick = () => { EG.sfx.correct(); EG.profiles.select(p.id); route(); };
      box.appendChild(b);
    });
    const add = document.createElement("button");
    add.className = "kid add";
    add.innerHTML = `<span class="face">＋</span><b>ふやす</b><small>&nbsp;</small>`;
    add.onclick = () => { EG.sfx.tap(); go("newkid"); };
    box.appendChild(add);
  }

  // ---------- ⑥ こどもを ふやす ----------
  let pickIcon = ICONS[0], pickColor = COLORS[0];
  function resetKidForm() {
    pickIcon = ICONS[Math.floor(Math.random() * ICONS.length)];
    pickColor = COLORS[EG.profiles.list().length % COLORS.length];
    $("kid-name").value = "";
    $("kid-err").textContent = "";
    // はじめての こどもは「もどる」なし
    document.querySelector("#scr-newkid [data-back]").style.visibility = EG.profiles.list().length ? "visible" : "hidden";
    renderKidPick();
  }
  function renderKidPick() {
    const pv = $("kid-preview");
    pv.style.setProperty("--kc", pickColor);
    pv.querySelector("span").textContent = pickIcon;
    $("kid-icons").innerHTML = "";
    ICONS.forEach((ic) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = ic;
      b.className = ic === pickIcon ? "on" : "";
      b.onclick = () => { EG.sfx.pop(ICONS.indexOf(ic)); pickIcon = ic; renderKidPick(); };
      $("kid-icons").appendChild(b);
    });
    $("kid-colors").innerHTML = "";
    COLORS.forEach((c, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.style.setProperty("--c", c);
      b.className = c === pickColor ? "on" : "";
      b.setAttribute("aria-label", "いろ " + (i + 1));
      b.onclick = () => { EG.sfx.pop(i); pickColor = c; renderKidPick(); };
      $("kid-colors").appendChild(b);
    });
  }
  $("kid-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("kid-name").value.trim();
    if (!name) { $("kid-err").textContent = "なまえを いれてね"; EG.sfx.wrong(); return; }
    const first = !EG.profiles.list().length;
    const id = EG.profiles.create({ name, icon: pickIcon, color: pickColor });
    EG.sfx.fanfare();
    if (first) EG.profiles.select(id);
    route();
  });

  // ---------- ⑦ ゲーム一覧 ----------
  const grid = $("grid");
  function renderGames() {
    const kid = EG.profiles.current();
    if (!kid) return route();
    const chip = $("kid-chip");
    chip.style.setProperty("--kc", kid.color);
    chip.querySelector(".ic").textContent = kid.icon;
    chip.querySelector(".nm").textContent = kid.name;
    grid.innerHTML = "";
    window.EG_GAMES.filter((g) => !g.hidden).forEach((g, i) => {
      const a = document.createElement("a");
      a.className = "card";
      a.href = g.href;
      a.dataset.id = g.id;
      a.style.setProperty("--c", g.color);
      a.style.animationDelay = i * 70 + "ms";
      a.innerHTML = `<span class="mystars"></span><span class="emoji"></span><span class="t"></span><span class="s"></span>`;
      const ic = a.querySelector(".emoji");
      ic.textContent = g.symbol || g.emoji;
      if (g.symbol) ic.classList.add("sym");
      a.querySelector(".t").textContent = g.title;
      a.querySelector(".s").textContent = g.sub || "";
      a.addEventListener("click", () => EG.sfx.tap());
      grid.appendChild(a);
    });
    updateStars();
    updateSyncDot();
  }
  function updateStars() {
    grid.querySelectorAll(".card").forEach((a) => {
      const n = EG.stars.get(a.dataset.id), el = a.querySelector(".mystars");
      el.textContent = n ? "⭐" + n : "";
      el.style.display = n ? "" : "none";
    });
    $("total").querySelector("b").textContent = EG.stars.get();
  }
  $("kid-chip").onclick = () => { EG.sfx.tap(); EG.profiles.unselect(); route(); };

  function updateSyncDot() {
    const dot = $("sync-dot");
    if (EG.mode.get() !== "cloud" || !EG.cloud) { dot.className = "sync-dot"; dot.title = ""; return; }
    const s = EG.cloud.state();
    dot.className = "sync-dot " + (s.busy ? "busy" : s.error ? "err" : "ok");
    dot.title = s.error || (s.lastSync ? "どうき " + fmtTime(s.lastSync) : "");
  }
  const fmtTime = (t) => (t ? new Date(t).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

  // データが変わったら画面を更新（クラウド同期・ほかの端末での削除など）
  window.addEventListener("eg:data", () => {
    if (cur === "games") { if (!EG.profiles.current()) route(); else updateStars(); }
    else if (cur === "who") renderWho();
    if ($("adult").open) fillAdult();
  });
  window.addEventListener("eg:cloud", () => { updateSyncDot(); if ($("adult").open) fillCloud(); });

  // ---------- おとなメニュー ----------
  const dlg = $("adult");
  EG.adultLock($("games-gear"), openAdult);
  EG.adultLock($("who-gear"), openAdult);
  $("a-close").onclick = () => dlg.close();
  function openAdult() {
    fillAdult();
    $("a-qr-box").hidden = true;
    dlg.showModal();
  }
  function fillAdult() {
    $("s-sound").checked = EG.settings.sound;
    $("s-voice").checked = EG.settings.voice;
    $("s-rate").value = EG.settings.rate;
    fillVoices();
    fillKids();
    fillCloud();
    fillDebug();
  }

  // おと・こえ
  async function fillVoices() {
    await EG.voicesReady;
    const sel = $("s-voiceuri");
    sel.innerHTML = "";
    sel.add(new Option("おすすめ（じどう）", ""));
    EG.englishVoices().forEach((v) => sel.add(new Option(`${v.name} (${v.lang})`, v.voiceURI)));
    sel.value = EG.settings.voiceURI;
    if (sel.value !== EG.settings.voiceURI) sel.value = "";
  }
  const SAMPLE = "one, two, three. Three plus two equals five!";
  $("s-voiceuri").onchange = (e) => { EG.settings.voiceURI = e.target.value; EG.saveSettings(); EG.say(SAMPLE); };
  $("s-test").onclick = () => EG.say(SAMPLE);
  $("s-sound").onchange = (e) => { EG.settings.sound = e.target.checked; EG.saveSettings(); };
  $("s-voice").onchange = (e) => { EG.settings.voice = e.target.checked; EG.saveSettings(); };
  $("s-rate").onchange = (e) => { EG.settings.rate = +e.target.value; EG.saveSettings(); EG.say("one, two, three"); };

  // こども
  function fillKids() {
    const box = $("a-kids");
    box.innerHTML = "";
    const list = EG.profiles.list();
    if (!list.length) box.innerHTML = `<p class="note">まだ いません</p>`;
    list.forEach((p) => {
      const row = document.createElement("div");
      row.className = "a-kid";
      row.style.setProperty("--kc", p.color);
      row.innerHTML = `<span class="ic"></span><span class="nm"></span><button class="rs">ほし0</button><button class="del">けす</button>`;
      row.querySelector(".ic").textContent = p.icon;
      row.querySelector(".nm").textContent = `${p.name}　⭐${EG.stars.get(null, p.id)}`;
      row.querySelector(".rs").onclick = () => {
        if (confirm(`${p.name} の ほしを 0 に しますか？`)) { EG.stars.reset(p.id); fillAdult(); }
      };
      row.querySelector(".del").onclick = () => {
        if (doubleConfirm(`${p.name} を けします。ほし・すすみぐあいも きえます${EG.mode.get() === "cloud" ? "（ほかの たんまつ からも）" : ""}。`)) {
          EG.profiles.remove(p.id); fillAdult();
          if (cur === "games" && !EG.profiles.current()) route();
        }
      };
      box.appendChild(row);
    });
  }
  $("a-addkid").onclick = () => { dlg.close(); go("newkid"); };
  $("a-reset-all").onclick = () => {
    if (confirm("ぜんいんの ほしを 0 に しますか？")) { EG.stars.reset(); fillAdult(); }
  };

  // クラウド
  function fillCloud() {
    const isCloud = EG.mode.get() === "cloud" && EG.cloud && EG.cloud.isLoggedIn();
    $("a-guest").hidden = isCloud;
    $("a-cloud").hidden = !isCloud;
    dlg.querySelectorAll(".cloud-only").forEach((b) => (b.hidden = !isCloud));
    if (!isCloud) return;
    const s = EG.cloud.state();
    $("a-cloud-info").innerHTML = "";
    $("a-cloud-info").append(
      `ログイン中：${s.email}`, document.createElement("br"),
      `Firebase：${s.projectId}`, document.createElement("br"),
      `つながっている たんまつ：${s.devices}だい`, document.createElement("br"),
      `さいごに どうき：${s.busy ? "どうき中…" : fmtTime(s.lastSync)}`
    );
    $("a-cloud-err").textContent = s.error;
    $("a-rescan").hidden = !s.needRelogin;
    $("a-showqr").disabled = s.needRelogin;
  }
  $("a-login").onclick = () => { dlg.close(); go("login"); };
  $("a-sync").onclick = async (e) => { const btn = e.currentTarget; btn.disabled = true; await EG.cloud.syncNow(); btn.disabled = false; fillAdult(); };
  $("a-showqr").onclick = async () => {
    const box = $("a-qr-box");
    box.hidden = !box.hidden;
    if (!box.hidden) await renderQr();
  };
  async function renderQr() {
    if (!window.qrcode) await EG.loadScript("shared/vendor/qrcode.js");
    const qr = qrcode(0, "M");
    qr.addData(EG.cloud.qrPayload());
    qr.make();
    $("a-qr").innerHTML = qr.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
  }
  $("a-regen").onclick = async (e) => {
    if (!doubleConfirm("QR を つくりなおします。ふるい QR は つかえなくなり、ほかの たんまつは あたらしい QR で ログインしなおしが ひつようです。")) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try { await EG.cloud.regenerate(); await renderQr(); EG.toast("あたらしい QR に なりました"); }
    catch (err) { alert(err.message); }
    finally { btn.disabled = false; }
  };
  $("a-rescan").onclick = () => { dlg.close(); startScan(); };

  // デバッグ
  async function fillDebug() {
    const kid = EG.profiles.current();
    const c = EG.cloud ? EG.cloud.debug() : {};
    let persisted = "—";
    try { persisted = navigator.storage && navigator.storage.persisted ? ((await navigator.storage.persisted()) ? "はい" : "いいえ") : "—"; } catch { /* noop */ }
    const rows = [
      ["モード", EG.mode.get() || "（みせってい）"],
      ["たんまつID", c.deviceId || "—"],
      ["こども", EG.profiles.list().length + "にん"],
      ["いま あそぶ こ", kid ? kid.name : "—"],
      ["データの かたち", "v" + EG.SCHEMA_VERSION],
      ["ログイン", c.uid ? "はい" : "いいえ"],
      ["Firebase", c.projectId || "—"],
      ["さいごに どうき", fmtTime(c.lastSync)],
      ["けされにくい ほぞん", persisted],
    ];
    const t = $("a-dbg");
    t.innerHTML = "";
    rows.forEach(([k, v]) => { const tr = t.insertRow(); tr.insertCell().textContent = k; tr.insertCell().textContent = v; });
    $("a-json").textContent = JSON.stringify(dump(), null, 2);
  }
  /** 保存データの中身（パスワード・トークンは伏せる） */
  function dump() {
    const out = {};
    try {
      Object.keys(localStorage).filter((k) => k.startsWith("eg.")).sort().forEach((k) => {
        let v = localStorage.getItem(k);
        try { v = JSON.parse(v); } catch { /* 文字列のまま */ }
        if (k === "eg.cloud" && v && typeof v === "object") {
          v = Object.assign({}, v);
          ["password", "idToken", "refreshToken", "apiKey"].forEach((x) => { if (v[x]) v[x] = "（ひみつ）"; });
        }
        out[k] = v;
      });
    } catch { /* noop */ }
    return out;
  }
  $("a-copy").onclick = async () => {
    try { await navigator.clipboard.writeText($("a-json").textContent); EG.toast("コピーしました"); }
    catch { EG.toast("コピーできませんでした"); }
  };

  /** 消す前の2回確認（2回目は「けす」と入力） */
  function doubleConfirm(msg) {
    if (!confirm(msg + "\n\nほんとうに けしますか？")) return false;
    const v = prompt("かくにんのため「けす」と にゅうりょく してください");
    return (v || "").trim() === "けす";
  }
  $("d-local").onclick = async () => {
    if (!doubleConfirm("この たんまつの データ（ログイン・こども・ほし・せってい）を ぜんぶ けします。" + (EG.mode.get() === "cloud" ? "クラウドの データは のこります。" : ""))) return;
    await EG.wipeLocal();
    location.replace(location.pathname);
  };
  $("d-cloud").onclick = async (e) => {
    if (!doubleConfirm("クラウドの データ（すべての たんまつの こども・ほし・すすみぐあい）を ぜんぶ けします。")) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try { await EG.cloud.wipeCloud(); EG.toast("クラウドの データを けしました"); dlg.close(); route(); }
    catch (err) { alert(err.message); }
    finally { btn.disabled = false; }
  };
  $("d-all").onclick = async () => {
    if (!doubleConfirm("クラウドと この たんまつの データを ぜんぶ けして、さいしょの がめんに もどります。（Firebase の プロジェクトと アカウントは のこります）")) return;
    try { await EG.cloud.wipeCloud(); } catch (err) { if (!confirm(err.message + "\nこの たんまつ だけ けしますか？")) return; }
    await EG.wipeLocal();
    location.replace(location.pathname);
  };

  // ページを開いたまま QR の URL が開かれたとき
  window.addEventListener("hashchange", () => { handleJoinHash().then((ok) => ok || route()); });

  // ---------- はじめる ----------
  (async () => {
    await EG.cloudReady;
    if (await handleJoinHash()) return;
    route();
  })();
})();
