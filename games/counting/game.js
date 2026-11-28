/* かぞえよう：ブロックを数える／英語を聞いて数字をえらぶ／タップで数える */
(function () {
  "use strict";
  const GAME_ID = "counting";
  const ROUND = 5; // 1回のあそびで何問か

  const $ = (id) => document.getElementById(id);
  const menu = $("menu"), play = $("play"), word = $("word"), choicesEl = $("choices"), progressEl = $("progress");

  let max = 10, mode = null, qIndex = 0, last = 0;
  // 画面に合わせて拡大・縮小（スクロールしない）
  EG.fit($("menu-fit"), { fill: true });
  const stage = EG.fit($("stage"), { max: 3 });
  const BLOCK = 48; // ブロックの基本の大きさ（EG.fit で画面に合わせて拡大される）

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
    let n;
    do { n = EG.randInt(1, max); } while (n === last && max > 1);
    return (last = n);
  }

  function next() {
    if (qIndex >= ROUND) {
      EG.showReward({ title: "ぜんぶ できたね！", emoji: "🏆", onAgain: () => start(mode) });
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

  /** ブロックを1つずつ光らせながら英語で数える */
  async function countAlong(blocks) {
    for (let i = 0; i < blocks.length; i++) {
      blocks[i].classList.add("count-on", "tapped");
      blocks[i].innerHTML = `<span class="num">${i + 1}</span>`;
      word.textContent = EG.numberWord(i + 1);
      EG.sfx.pop(i);
      await EG.say(EG.numberWord(i + 1), "en", { speed: 1.2 });
      await EG.wait(80);
    }
  }

  // ---- モード1：いくつ？ ----
  function howmany(n) {
    const blocks = EG.renderBlocks(stage.appendChild(clear()), [{ count: n, color: "a" }], { size: BLOCK });
    EG.say("How many?");
    const opts = EG.makeChoices(n, 3, 1, max);
    EG.renderChoices(choicesEl, opts, n, {
      label: (v) => `<span class="choice-num">${v}</span><small>${EG.numberWord(v)}</small>`,
      onCorrect: async () => {
        await countAlong(blocks);
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
    const box = clear();
    const btn = document.createElement("button");
    btn.className = "eg-btn listen";
    btn.textContent = "🔊";
    btn.setAttribute("aria-label", "もういちど きく");
    btn.onclick = () => EG.sayNumber(n);
    box.appendChild(btn);
    stage.appendChild(box);
    EG.wait(300).then(() => EG.sayNumber(n));

    const opts = EG.makeChoices(n, max <= 10 ? 3 : 4, 1, max);
    EG.renderChoices(choicesEl, opts, n, {
      onCorrect: async () => {
        box.innerHTML = "";
        const g = document.createElement("div");
        box.appendChild(g);
        EG.renderBlocks(g, [{ count: n, color: "c" }], { size: BLOCK, numbers: true, stagger: 40 });
        word.textContent = `${n}  ${EG.numberWord(n)}!`;
        await EG.say(EG.numberWord(n) + "!");
        await EG.wait(500);
        finishQuestion();
      },
      onWrong: (v, b) => { EG.say("This is " + EG.numberWord(v)); },
    });
  }

  // ---- モード3：タップで かぞえる（まちがいなし） ----
  function tap(n) {
    const box = clear();
    const blocks = EG.renderBlocks(box, [{ count: n, color: "b" }], { size: BLOCK });
    stage.appendChild(box);
    choicesEl.innerHTML = `<div class="tap-hint">ブロックを タップしてね</div>`;
    let counted = 0;
    blocks.forEach((b) => {
      b.style.cursor = "pointer";
      b.addEventListener("pointerdown", async () => {
        if (b.dataset.done) return;
        b.dataset.done = "1";
        counted++;
        b.style.setProperty("--c", "var(--block-c)");
        b.classList.add("tapped");
        b.innerHTML = `<span class="num">${counted}</span>`;
        word.textContent = EG.numberWord(counted);
        EG.sfx.pop(counted);
        EG.sayNumber(counted);
        if (counted === n) {
          await EG.wait(700);
          choicesEl.innerHTML = `<div class="big-num">${n}</div>`;
          word.textContent = `${EG.numberWord(n)}!`;
          EG.sfx.correct();
          EG.confetti(60);
          await EG.say(`${EG.numberWord(n)}! You counted ${EG.numberWord(n)}!`);
          finishQuestion();
        }
      });
    });
  }

  function clear() {
    stage.innerHTML = "";
    const d = document.createElement("div");
    return d;
  }
})();
