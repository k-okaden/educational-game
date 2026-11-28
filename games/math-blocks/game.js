/*
 * けいさんブロック：たしざん・ひきざん・かけざん
 * URL の ?op=add / sub / mul で切りかえる（registry.js で別々のカードとして登録）
 */
(function () {
  "use strict";
  const ROUND = 5;
  const params = new URLSearchParams(location.search);
  const OP = ["add", "sub", "mul"].includes(params.get("op")) ? params.get("op") : "add";

  /*
   * 出題の設定。レベルを増やしたいときはここに足すだけ。
   *  gen()   : { a, b, answer } を返す
   *  hint    : "always" ならブロックをいつも見せる / "button" ならヒントボタンで見せる
   */
  const CONFIG = {
    add: {
      title: "たしざん", sym: "+", lead: "あわせて いくつ？",
      levels: [
        { label: "5まで", icon: "🟦🟧", hint: "always", gen: () => genAdd(5) },
        { label: "10まで", icon: "🟦🟦🟧", hint: "always", gen: () => genAdd(10) },
        { label: "20まで", icon: "🔟➕", hint: "button", gen: () => genAdd(20, 3) },
      ],
    },
    sub: {
      title: "ひきざん", sym: "−", lead: "のこりは いくつ？",
      levels: [
        { label: "5まで", icon: "🟦❌", hint: "always", gen: () => genSub(5) },
        { label: "10まで", icon: "🟦🟦❌", hint: "always", gen: () => genSub(10) },
        { label: "20まで", icon: "🔟➖", hint: "button", gen: () => genSub(20, 3) },
      ],
    },
    mul: {
      title: "かけざん", sym: "×", lead: "ぜんぶで いくつ？",
      levels: [
        { label: "1〜3のだん", icon: "🟦🟦", hint: "always", gen: () => genMul(3, 3) },
        { label: "1〜5のだん", icon: "🟦🟦🟦", hint: "always", gen: () => genMul(5, 5) },
        { label: "1〜9のだん", icon: "🧮", hint: "button", gen: () => genMul(9, 9) },
      ],
    },
  }[OP];

  function genAdd(maxSum, minSum = 2) {
    const sum = EG.randInt(minSum, maxSum);
    const a = EG.randInt(1, sum - 1);
    return { a, b: sum - a, answer: sum };
  }
  function genSub(maxA, minA = 2) {
    const a = EG.randInt(minA, maxA);
    const b = EG.randInt(1, a);
    return { a, b, answer: a - b };
  }
  // 日本式：a × b は「a こずつ が b つぶん」
  function genMul(maxA, maxB) {
    const a = EG.randInt(1, maxA), b = EG.randInt(1, maxB);
    return { a, b, answer: a * b };
  }

  const $ = (id) => document.getElementById(id);
  const menu = $("menu"), play = $("play"), eq = $("eq"), word = $("word"), choicesEl = $("choices"), progressEl = $("progress");
  const GAME_ID = OP;
  const OP_WORD = { add: "plus", sub: "minus", mul: "times" }[OP];
  const phrase = (q) => `${EG.numberWord(q.a)} ${OP_WORD} ${EG.numberWord(q.b)}`;
  let level = null, qIndex = 0, lastKey = "";
  // 画面に合わせて拡大・縮小（スクロールしない）
  EG.fit($("menu-fit"), { fill: true });
  const stageBox = $("stage");
  const stage = EG.fit(stageBox, { max: 3 });
  const BLOCK = 44; // ブロックの基本の大きさ（EG.fit で画面に合わせて拡大される）

  document.title = CONFIG.title;
  EG.mountHeader({
    title: CONFIG.title,
    onBack: () => {
      if (!play.classList.contains("eg-hidden")) { showMenu(); return false; }
    },
  });

  // ---- メニュー ----
  $("lead").textContent = CONFIG.lead;
  CONFIG.levels.forEach((lv, i) => {
    const b = document.createElement("button");
    b.className = "eg-btn";
    b.innerHTML = `<span class="e">${lv.icon}</span>${lv.label}<small>${"⭐".repeat(i + 1)}</small>`;
    b.onclick = () => { EG.sfx.tap(); start(lv); };
    $("levels").appendChild(b);
  });

  function showMenu() {
    speechSynthesis?.cancel?.();
    play.classList.add("eg-hidden");
    menu.classList.remove("eg-hidden");
  }
  function start(lv) {
    level = lv; qIndex = 0;
    menu.classList.add("eg-hidden");
    play.classList.remove("eg-hidden");
    next();
  }

  function newQuestion() {
    let q, tries = 0;
    do { q = level.gen(); tries++; } while (`${q.a},${q.b}` === lastKey && tries < 20);
    lastKey = `${q.a},${q.b}`;
    return q;
  }

  // ---- 出題 ----
  function next() {
    if (qIndex >= ROUND) {
      EG.showReward({ title: "ぜんぶ できたね！", emoji: "🏆", onAgain: () => start(level) });
      return;
    }
    EG.renderProgress(progressEl, qIndex, ROUND);
    const q = newQuestion();
    word.textContent = "";
    eq.innerHTML = `<span class="a">${q.a}</span><span>${CONFIG.sym}</span><span class="b">${q.b}</span><span>=</span><span class="q">?</span>`;

    const speakQ = () => EG.say(phrase(q));
    eq.onclick = speakQ;

    const view = drawers[OP](q);
    if (level.hint === "button") {
      stageBox.classList.add("eg-hidden");
      const hb = document.createElement("button");
      hb.className = "eg-btn hint-btn";
      hb.textContent = "💡 ヒント";
      hb.onclick = () => { EG.sfx.tap(); stageBox.classList.remove("eg-hidden"); hb.remove(); view.reveal?.(); };
      stageBox.after(hb);
      view.cleanup = () => hb.remove();
    } else {
      stageBox.classList.remove("eg-hidden");
      view.reveal?.();
    }
    speakQ();

    const max = OP === "mul" ? Math.max(q.answer + 10, 10) : 20;
    EG.renderChoices(choicesEl, EG.makeChoices(q.answer, 3, 0, max), q.answer, {
      onCorrect: async () => {
        view.cleanup?.();
        stageBox.classList.remove("eg-hidden");
        const qEl = eq.querySelector(".q");
        qEl.textContent = q.answer;
        qEl.classList.add("done");
        await view.celebrate();
        word.textContent = `${phrase(q)} = ${EG.numberWord(q.answer)}`;
        await EG.say(`${phrase(q)} equals ${EG.numberWord(q.answer)}!`);
        EG.confetti(60);
        EG.stars.add(GAME_ID);
        qIndex++;
        EG.renderProgress(progressEl, qIndex, ROUND);
        await EG.wait(1000);
        next();
      },
      onWrong: (v) => EG.say(EG.numberWord(v)),
    });
  }

  // ---- ブロックの見せ方（演算ごと） ----
  const drawers = {
    // たしざん：青と橙の2つのかたまり → 正解したら1つにがったい
    add(q) {
      stage.innerHTML = "";
      const size = BLOCK;
      const row = Object.assign(document.createElement("div"), { className: "stage-row" });
      const ga = document.createElement("div");
      const op = Object.assign(document.createElement("div"), { className: "op", textContent: "+" });
      const gb = document.createElement("div");
      row.append(ga, op, gb);
      stage.appendChild(row);
      EG.renderBlocks(ga, [{ count: q.a, color: "a" }], { size });
      EG.renderBlocks(gb, [{ count: q.b, color: "b" }], { size, stagger: 60 });
      return {
        async celebrate() {
          stage.innerHTML = "";
          const g = document.createElement("div");
          stage.appendChild(g);
          const blocks = EG.renderBlocks(g, [{ count: q.a, color: "a" }, { count: q.b, color: "b" }], { size: BLOCK, stagger: 30 });
          await EG.wait(q.answer * 30 + 300);
          blocks.forEach((b, i) => setTimeout(() => { b.innerHTML = `<span class="num">${i + 1}</span>`; EG.sfx.pop(i); }, i * 70));
          await EG.wait(q.answer * 70 + 200);
        },
      };
    },

    // ひきざん：a こ ならべて、b こ に ✖ → 正解したら とんでいく
    sub(q) {
      stage.innerHTML = "";
      const g = document.createElement("div");
      stage.appendChild(g);
      const blocks = EG.renderBlocks(g, [{ count: q.a, color: "a" }], { size: BLOCK });
      const leaving = blocks.slice(q.a - q.b);
      let timer;
      return {
        reveal() {
          timer = setTimeout(() => leaving.forEach((b, i) => setTimeout(() => { b.classList.add("gone"); EG.sfx.pop(12 - i); }, i * 120)), 700);
        },
        async celebrate() {
          clearTimeout(timer);
          leaving.forEach((b) => { b.classList.add("gone"); b.style.animationDelay = "0ms"; b.classList.add("fly"); });
          await EG.wait(800);
          leaving.forEach((b) => (b.style.visibility = "hidden"));
          blocks.slice(0, q.answer).forEach((b, i) => setTimeout(() => {
            b.style.setProperty("--c", "var(--block-c)");
            b.classList.add("tapped");
            b.innerHTML = `<span class="num">${i + 1}</span>`;
            EG.sfx.pop(i);
          }, i * 90));
          await EG.wait(q.answer * 90 + 300);
        },
      };
    },

    // かけざん：a こずつ の れつ が b つ。正解したら「2, 4, 6…」と とびかぞえ
    mul(q) {
      stage.innerHTML = "";
      const grid = document.createElement("div");
      grid.className = "mul-grid";
      stage.appendChild(grid);
      const size = 36;
      const rows = [];
      for (let r = 0; r < q.b; r++) {
        const row = document.createElement("div");
        row.className = "mul-row";
        const tag = Object.assign(document.createElement("span"), { className: "tag" });
        const g = document.createElement("div");
        g.style.setProperty("--gap", "4px");
        row.append(tag, g);
        grid.appendChild(row);
        EG.renderBlocks(g, [{ count: q.a, color: r % 2 ? "b" : "a" }], { cols: q.a, size, stagger: 25 });
        g.querySelectorAll(".eg-block").forEach((b) => (b.style.animationDelay = r * 150 + "ms"));
        rows.push({ tag, g });
      }
      return {
        async celebrate() {
          for (let r = 0; r < rows.length; r++) {
            const n = q.a * (r + 1);
            rows[r].tag.textContent = n;
            rows[r].tag.classList.add("on");
            rows[r].g.querySelectorAll(".eg-block").forEach((b) => { b.classList.remove("tapped"); void b.offsetWidth; b.classList.add("tapped"); });
            EG.sfx.pop(r * 2);
            await EG.say(EG.numberWord(n), "en", { speed: 1.2 });
          }
        },
      };
    },
  };
})();
