/* かぞえよう：ブロックを数える／英語を聞いて数字をえらぶ／タップで数える（〜10・〜20・〜100） */
(function () {
  "use strict";
  const GAME_ID = "counting";
  const ROUND = 5; // 1回のあそびで何問か
  // 範囲ごとの出題（前の範囲と重ならないようにする：#16）
  const RANGES = { 10: [1, 10], 20: [11, 20], 100: [21, 100] };

  const $ = (id) => document.getElementById(id);
  const menu = $("menu"), play = $("play"), word = $("word"), choicesEl = $("choices"), progressEl = $("progress");

  let max = 10, mode = null, qIndex = 0, last = 0;
  // 画面に合わせて拡大・縮小（スクロールしない）
  EG.fit($("menu-fit"), { fill: true });
  const stage = EG.fit($("stage"), { max: 3 });
  const BLOCK = 48; // ブロックの基本の大きさ（EG.fit で画面に合わせて拡大される）
  const SMALL = 26; // 10のぼう のときのブロック

  EG.mountHeader({
    title: "かぞえよう",
    onBack: () => {
      if (!play.classList.contains("eg-hidden")) { showMenu(); return false; } // プレイ中はメニューにもどる
    },
  });

  $("range").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    EG.sfx.tap();
    max = +b.dataset.max;
    $("range").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  });
  menu.querySelector(".menu").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    EG.sfx.tap();
    start(b.dataset.mode);
  });

  function showMenu() {
    speechSynthesis?.cancel?.();
    play.classList.add("eg-hidden");
    menu.classList.remove("eg-hidden");
  }

  function start(m) {
    mode = m; qIndex = 0;
    menu.classList.add("eg-hidden");
    play.classList.remove("eg-hidden");
    next();
  }

  /** 前回と同じ数が続かないように出題 */
  function pickNumber() {
    const [lo, hi] = RANGES[max];
    let n;
    do { n = EG.randInt(lo, hi); } while (n === last && hi > lo);
    return (last = n);
  }
  const big = () => max === 100;

  function next() {
    if (qIndex >= ROUND) {
      EG.showReward({ title: "ぜんぶ できたね！", emoji: "🏆", onAgain: () => start(mode), onMenu: showMenu, menuLabel: "かぞえようの はじめ" });
      return;
    }
    EG.renderProgress(progressEl, qIndex, ROUND);
    word.textContent = "";
    choicesEl.innerHTML = "";
    const n = pickNumber();
    ({ howmany, listen, tap })[mode](n);
  }

  async function finishQuestion() {
    EG.stars.add(GAME_ID);
    qIndex++;
    EG.renderProgress(progressEl, qIndex, ROUND);
    await EG.wait(900);
    next();
  }

  /**
   * ブロックを並べる。〜20 は1こずつ、〜100 は 10のぼう＋ばら
   * @returns {{items: Array<{el:HTMLElement, value:number}>}}  数える順（ぼう=10、ばら=1）
   */
  function drawNumber(box, n, color) {
    if (!big()) {
      const blocks = EG.renderBlocks(box, [{ count: n, color }], { size: BLOCK, stagger: 40 });
      return blocks.map((el) => ({ el, value: 1 }));
    }
    const t = EG.renderTens(box, EG.tensOf(n, color), { size: SMALL, stagger: 30 });
    return t.rods.map((el) => ({ el, value: 10 })).concat(t.ones.map((el) => ({ el, value: 1 })));
  }

  /** 1つずつ光らせながら英語で数える（ぼうは 10ずつ：ten, twenty, …） */
  async function countAlong(items) {
    let total = 0;
    for (let i = 0; i < items.length; i++) {
      total += items[i].value;
      items[i].el.classList.add("count-on", "tapped");
      if (items[i].value === 1 && !big()) items[i].el.innerHTML = `<span class="num">${total}</span>`;
      word.textContent = EG.numberWord(total);
      EG.sfx.pop(i);
      await EG.say(EG.numberWord(total), "en", { speed: 1.2 });
      await EG.wait(60);
    }
  }

  const numLabel = (v) => `<span class="choice-num">${v}</span><small>${EG.numberWord(v)}</small>`;
  function newBox() { stage.innerHTML = ""; const d = document.createElement("div"); stage.appendChild(d); return d; }

  // ---- モード1：いくつ？ ----
  function howmany(n) {
    const items = drawNumber(newBox(), n, "a");
    EG.say("How many?");
    const [lo, hi] = RANGES[max];
    const opts = EG.makeChoices(n, 3, Math.max(1, lo - 2), hi);
    EG.renderChoices(choicesEl, opts, n, {
      label: numLabel,
      onCorrect: async () => {
        await countAlong(items);
        word.textContent = `${n}  ${EG.numberWord(n)}!`;
        EG.confetti(60);
        await EG.say(EG.numberWord(n) + "!");
        finishQuestion();
      },
      onWrong: (v) => EG.say(EG.numberWord(v)),
    });
  }

  // ---- モード2：えいごで きこう ----
  function listen(n) {
    const box = newBox();
    const btn = document.createElement("button");
    btn.className = "eg-btn listen";
    btn.textContent = "🔊";
    btn.setAttribute("aria-label", "もういちど きく");
    btn.onclick = () => EG.sayNumber(n);
    box.appendChild(btn);
    EG.wait(300).then(() => EG.sayNumber(n));

    const [lo, hi] = RANGES[max];
    const opts = EG.makeChoices(n, max === 10 ? 3 : 4, Math.max(1, lo - 2), hi);
    EG.renderChoices(choicesEl, opts, n, {
      label: big() ? numLabel : (v) => v,
      onCorrect: async () => {
        box.innerHTML = "";
        if (big()) drawNumber(box, n, "c");
        else EG.renderBlocks(box, [{ count: n, color: "c" }], { size: BLOCK, numbers: true, stagger: 40 });
        word.textContent = `${n}  ${EG.numberWord(n)}!`;
        await EG.say(EG.numberWord(n) + "!");
        await EG.wait(500);
        finishQuestion();
      },
      onWrong: (v) => { EG.say("This is " + EG.numberWord(v)); },
    });
  }

  // ---- モード3：タップで かぞえる（まちがいなし。ぼうは +10、ばらは +1） ----
  function tap(n) {
    const box = newBox();
    const items = drawNumber(box, n, "b");
    choicesEl.innerHTML = `<div class="tap-hint">${big() ? "ぼう（10）と ブロックを<br>タップしてね" : "ブロックを タップしてね"}</div>`;
    let counted = 0, done = 0;
    items.forEach(({ el, value }) => {
      el.style.cursor = "pointer";
      el.addEventListener("pointerdown", async () => {
        if (el.dataset.done) return;
        el.dataset.done = "1";
        counted += value; done++;
        if (value === 10) el.querySelectorAll(".eg-block").forEach((b) => b.style.setProperty("--c", "var(--block-c)"));
        else el.style.setProperty("--c", "var(--block-c)");
        el.classList.add("tapped");
        if (!big()) el.innerHTML = `<span class="num">${counted}</span>`;
        word.textContent = EG.numberWord(counted);
        EG.sfx.pop(done);
        EG.sayNumber(counted);
        if (done === items.length) {
          await EG.wait(700);
          choicesEl.innerHTML = `<div class="big-num">${n}</div>`;
          word.textContent = `${EG.numberWord(n)}!`;
          EG.sfx.correct();
          EG.sfx.cheer();
          EG.confetti(60);
          await EG.wait(EG.settings.cheer && EG.settings.sound ? 550 : 0);
          await EG.say(`${EG.numberWord(n)}! You counted ${EG.numberWord(n)}!`);
          finishQuestion();
        }
      });
    });
  }
})();
