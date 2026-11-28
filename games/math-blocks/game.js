/*
 * けいさんブロック：たしざん・ひきざん・かけざん・わりざん
 * URL の ?op=add / sub / mul / div で切りかえる（registry.js で別々のカードとして登録）
 */
(function () {
  "use strict";
  const ROUND = 5;
  const params = new URLSearchParams(location.search);
  const OP = ["add", "sub", "mul", "div"].includes(params.get("op")) ? params.get("op") : "add";

  /*
   * 出題の設定。レベルを増やしたいときはここに足すだけ。
   *  gen()   : { a, b, answer } を返す
   *  hint    : "always" ならブロックをいつも見せる / "button" ならヒントボタンで見せる
   *  max     : 答えの選択肢の上限
   * レベルどうしで出る数が重ならないように下限も決める（#16）
   */
  const CONFIG = {
    add: {
      title: "たしざん", sym: "+", word: "plus", lead: "あわせて いくつ？",
      levels: [
        { label: "5まで", icon: "🟦🟧", hint: "always", max: 6, gen: () => genAdd(2, 5) },
        { label: "10まで", icon: "🟦🟦🟧", hint: "always", max: 12, gen: () => genAdd(6, 10) },
        { label: "20まで", icon: "🔟➕", hint: "button", max: 22, gen: () => genAdd(11, 20) },
        { label: "100まで", icon: "💯", hint: "button", max: 100, gen: () => genAdd(21, 100) },
      ],
    },
    sub: {
      title: "ひきざん", sym: "−", word: "minus", lead: "のこりは いくつ？",
      levels: [
        { label: "5まで", icon: "🟦❌", hint: "always", max: 5, gen: () => genSub(2, 5) },
        { label: "10まで", icon: "🟦🟦❌", hint: "always", max: 10, gen: () => genSub(6, 10) },
        { label: "20まで", icon: "🔟➖", hint: "button", max: 20, gen: () => genSub(11, 20) },
        { label: "100まで", icon: "💯", hint: "button", max: 100, gen: () => genSub(21, 100) },
      ],
    },
    mul: {
      title: "かけざん", sym: "×", word: "times", lead: "ぜんぶで いくつ？",
      levels: [
        { label: "1〜3のだん", icon: "🟦🟦", hint: "always", max: 20, gen: () => genMul(1, 3, 5) },
        { label: "4・5のだん", icon: "🟦🟦🟦", hint: "always", max: 50, gen: () => genMul(4, 5, 9) },
        { label: "6〜10のだん", icon: "🧮", hint: "button", max: 100, gen: () => genMul(6, 10, 10) },
      ],
    },
    div: {
      title: "わりざん", sym: "÷", word: "divided by", lead: "おなじ かずずつ わけると？",
      levels: [
        { label: "10まで", icon: "🍪🍽", hint: "always", max: 10, gen: () => genDiv(2, 10, 5) },
        { label: "20まで", icon: "🍪🍽🍽", hint: "always", max: 12, gen: () => genDiv(11, 20, 5) },
        { label: "100まで", icon: "💯", hint: "button", max: 12, gen: () => genDiv(21, 100, 10) },
      ],
    },
  }[OP];
  EG.mathConfig = CONFIG; // テスト・デバッグ用

  function genAdd(lo, hi) {
    const sum = EG.randInt(lo, hi);
    const a = sum > 20 ? EG.randInt(2, sum - 2) : EG.randInt(1, sum - 1);
    return { a, b: sum - a, answer: sum };
  }
  function genSub(lo, hi) {
    const a = EG.randInt(lo, hi);
    const b = a > 20 ? EG.randInt(2, a - 1) : EG.randInt(1, a);
    return { a, b, answer: a - b };
  }
  // 日本式：a × b は「a こずつ が b つぶん」（a = だん）
  function genMul(aLo, aHi, bMax) {
    const a = EG.randInt(aLo, aHi), b = EG.randInt(1, bMax);
    return { a, b, answer: a * b };
  }
  // わりざん：a こを b つに おなじ数ずつ わける（あまりなし）
  function genDiv(lo, hi, bMax) {
    for (let i = 0; i < 200; i++) {
      const b = EG.randInt(2, bMax), c = EG.randInt(1, 10), a = b * c;
      if (a >= lo && a <= hi) return { a, b, answer: c };
    }
    return { a: lo % 2 ? lo + 1 : lo, b: 2, answer: (lo % 2 ? lo + 1 : lo) / 2 };
  }

  const $ = (id) => document.getElementById(id);
  const menu = $("menu"), play = $("play"), eq = $("eq"), word = $("word"), choicesEl = $("choices"), progressEl = $("progress");
  const GAME_ID = OP;
  const phrase = (q) => `${EG.numberWord(q.a)} ${CONFIG.word} ${EG.numberWord(q.b)}`;
  let level = null, qIndex = 0, lastKey = "";
  // 画面に合わせて拡大・縮小（スクロールしない）
  EG.fit($("menu-fit"), { fill: true });
  const stageBox = $("stage");
  const stage = EG.fit(stageBox, { max: 3 });
  const BLOCK = 44; // ブロックの基本の大きさ（EG.fit で画面に合わせて拡大される）
  const SMALL = 24; // 10のぼう のとき

  document.title = CONFIG.title;
  EG.mountHeader({
    title: CONFIG.title,
    onBack: () => {
      if (!play.classList.contains("eg-hidden")) { showMenu(); return false; }
    },
  });

  // ---- メニュー ----
  $("lead").textContent = CONFIG.lead;
  $("levels").style.gridTemplateColumns = `repeat(${CONFIG.levels.length}, minmax(0, 1fr))`;
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
      EG.showReward({ title: "ぜんぶ できたね！", emoji: "🏆", onAgain: () => start(level), onMenu: showMenu, menuLabel: CONFIG.title + "の はじめ" });
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

    const max = Math.max(level.max, q.answer + 2);
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

  const div = (cls) => Object.assign(document.createElement("div"), { className: cls || "" });
  /** 10のぼう・ばらを 1つずつ光らせる（大きい数のとき。読み上げはしない） */
  async function flashAll(els, ms = 70) {
    for (let i = 0; i < els.length; i++) {
      els[i].classList.remove("tapped"); void els[i].offsetWidth; els[i].classList.add("tapped");
      EG.sfx.pop(i);
      await EG.wait(ms);
    }
  }

  // ---- ブロックの見せ方（演算ごと） ----
  const drawers = {
    // たしざん：青と橙の2つのかたまり → 正解したら1つにがったい（100までは 10のぼう。ばらが10こになったら ぼう1本に）
    add(q) {
      stage.innerHTML = "";
      const big = q.answer > 20;
      const row = div("stage-row");
      const ga = div(), gb = div();
      row.append(ga, Object.assign(div("op"), { textContent: "+" }), gb);
      stage.appendChild(row);
      if (big) {
        EG.renderTens(ga, EG.tensOf(q.a, "a"), { size: SMALL });
        EG.renderTens(gb, EG.tensOf(q.b, "b"), { size: SMALL });
      } else {
        EG.renderBlocks(ga, [{ count: q.a, color: "a" }], { size: BLOCK });
        EG.renderBlocks(gb, [{ count: q.b, color: "b" }], { size: BLOCK, stagger: 60 });
      }
      return {
        async celebrate() {
          stage.innerHTML = "";
          const g = div();
          stage.appendChild(g);
          if (!big) {
            const blocks = EG.renderBlocks(g, [{ count: q.a, color: "a" }, { count: q.b, color: "b" }], { size: BLOCK, stagger: 30 });
            await EG.wait(q.answer * 30 + 300);
            blocks.forEach((b, i) => setTimeout(() => { b.innerHTML = `<span class="num">${i + 1}</span>`; EG.sfx.pop(i); }, i * 70));
            await EG.wait(q.answer * 70 + 200);
            return;
          }
          // ぼうを まとめて、ばらを ならべる
          const A = EG.tensOf(q.a, "a"), B = EG.tensOf(q.b, "b");
          const ones = A.ones.concat(B.ones);
          let t = EG.renderTens(g, { rods: A.rods.concat(B.rods), ones }, { size: SMALL, stagger: 15 });
          await EG.wait(700);
          if (ones.length >= 10) {
            // くりあがり：ばら10こ → ぼう1本
            g.innerHTML = "";
            t = EG.renderTens(g, { rods: A.rods.concat(B.rods, [ones.slice(0, 10)]), ones: ones.slice(10) }, { size: SMALL, stagger: 0 });
            const newRod = t.rods[t.rods.length - 1];
            newRod.classList.add("count-on");
            EG.sfx.correct();
            await EG.wait(700);
          }
          await flashAll(t.rods.concat(t.ones));
        },
      };
    },

    // ひきざん：a こ ならべて、b こ に ✖ → 正解したら とんでいく（100までは 10のぼう。たりないときは ぼう1本を ばら10こに）
    sub(q) {
      stage.innerHTML = "";
      const g = div();
      stage.appendChild(g);
      let timer, leaving = [], staying = [];
      if (q.a <= 20) {
        const blocks = EG.renderBlocks(g, [{ count: q.a, color: "a" }], { size: BLOCK });
        leaving = blocks.slice(q.a - q.b);
        staying = blocks.slice(0, q.answer);
        return {
          reveal() {
            timer = setTimeout(() => leaving.forEach((b, i) => setTimeout(() => { b.classList.add("gone"); EG.sfx.pop(12 - i); }, i * 120)), 700);
          },
          async celebrate() {
            clearTimeout(timer);
            leaving.forEach((b) => { b.classList.add("gone"); b.style.animationDelay = "0ms"; b.classList.add("fly"); });
            await EG.wait(800);
            leaving.forEach((b) => (b.style.visibility = "hidden"));
            staying.forEach((b, i) => setTimeout(() => {
              b.style.setProperty("--c", "var(--block-c)");
              b.classList.add("tapped");
              b.innerHTML = `<span class="num">${i + 1}</span>`;
              EG.sfx.pop(i);
            }, i * 90));
            await EG.wait(q.answer * 90 + 300);
          },
        };
      }
      // 大きい数
      const aT = Math.floor(q.a / 10), aO = q.a % 10, bT = Math.floor(q.b / 10), bO = q.b % 10;
      let t = EG.renderTens(g, EG.tensOf(q.a, "a"), { size: SMALL });
      let goneEls = [];
      const cross = () => {
        // うしろの ばら bO こ と ぼう bT 本 に ✖
        const ones = t.ones.slice(t.ones.length - bO);
        const rods = t.rods.slice(t.rods.length - bT);
        goneEls = ones.concat(rods);
        ones.forEach((b, i) => setTimeout(() => { b.classList.add("gone"); EG.sfx.pop(12 - i); }, i * 90));
        rods.forEach((r, i) => setTimeout(() => { r.querySelectorAll(".eg-block").forEach((b) => b.classList.add("gone")); EG.sfx.pop(3 - i); }, (ones.length + i) * 90));
        staying = t.rods.slice(0, t.rods.length - bT).concat(t.ones.slice(0, t.ones.length - bO));
      };
      let shown = null; // 「くりさがり → ✖」の見せ方（1回だけ）
      const show = (fast) => shown || (shown = (async () => {
        if (aO < bO) {
          // くりさがり：ぼう1本 → ばら10こ
          g.innerHTML = "";
          t = EG.renderTens(g, { rods: Array.from({ length: aT - 1 }, () => Array(10).fill("a")), ones: Array(aO + 10).fill("a") }, { size: SMALL, stagger: 0 });
          t.ones.slice(aO).forEach((b) => b.classList.add("tapped"));
          EG.sfx.correct();
          await EG.wait(fast ? 300 : 800);
        }
        cross();
        await EG.wait(fast ? 400 : 0);
      })());
      return {
        reveal() { timer = setTimeout(() => show(false), 700); },
        async celebrate() {
          clearTimeout(timer);
          await show(true);
          goneEls.forEach((el) => el.classList.add("fly"));
          await EG.wait(800);
          goneEls.forEach((el) => (el.style.visibility = "hidden"));
          staying.forEach((el) => {
            const bs = el.classList.contains("eg-rod") ? el.querySelectorAll(".eg-block") : [el];
            bs.forEach((b) => b.style.setProperty("--c", "var(--block-c)"));
          });
          await flashAll(staying);
        },
      };
    },

    // かけざん：a こずつ の れつ が b つ。正解したら「2, 4, 6…」と とびかぞえ
    mul(q) {
      stage.innerHTML = "";
      const grid = div("mul-grid");
      stage.appendChild(grid);
      const size = 36;
      const rows = [];
      for (let r = 0; r < q.b; r++) {
        const row = div("mul-row");
        const tag = div("tag");
        const g = div();
        g.style.setProperty("--gap", "4px");
        row.append(tag, g);
        grid.appendChild(row);
        EG.renderBlocks(g, [{ count: q.a, color: r % 2 ? "b" : "a" }], { cols: q.a, size, stagger: 25 });
        g.querySelectorAll(".eg-block").forEach((b) => (b.style.animationDelay = r * 120 + "ms"));
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

    // わりざん：a こ を b まいの おさらに 1こずつ くばる（おすそわけ）→ 1まいに いくつ？
    div(q) {
      stage.innerHTML = "";
      const wrap = div("div-wrap");
      const pile = div("div-pile");
      const plates = div("div-plates");
      wrap.append(pile, plates);
      stage.appendChild(wrap);
      const size = q.a > 30 ? 26 : 36;
      pile.style.setProperty("--size", size + "px");
      plates.style.setProperty("--size", size + "px");
      const cols = Math.min(10, q.a);
      const blocks = EG.renderBlocks(pile, [{ count: q.a, color: "a" }], { cols, size, stagger: 12 });
      const plateEls = Array.from({ length: q.b }, () => {
        const p = div("plate");
        const inner = div("plate-in");
        inner.style.gridTemplateColumns = `repeat(${Math.min(5, q.answer)}, auto)`;
        p.appendChild(inner);
        plates.appendChild(p);
        return inner;
      });
      plates.style.gridTemplateColumns = `repeat(${Math.min(q.b, 5)}, auto)`;
      let dealP = null, timer;
      const deal = () => dealP || (dealP = (async () => {
        const step = q.a > 40 ? 35 : 90;
        for (let i = 0; i < blocks.length; i++) {
          const b = blocks[blocks.length - 1 - i];
          const dst = plateEls[i % q.b];
          b.style.animation = "none";
          dst.appendChild(b);
          b.style.animation = "eg-pop .25s";
          if (i % q.b === 0) EG.sfx.pop(Math.floor(i / q.b));
          await EG.wait(step);
        }
      })());
      return {
        reveal() { timer = setTimeout(deal, 800); },
        async celebrate() {
          clearTimeout(timer);
          await deal();
          // 1まいめの おさらを かぞえる
          const first = [...plateEls[0].children];
          plateEls[0].parentNode.classList.add("on");
          first.forEach((b, i) => setTimeout(() => {
            b.style.setProperty("--c", "var(--block-c)");
            b.classList.add("tapped");
            b.innerHTML = `<span class="num">${i + 1}</span>`;
            EG.sfx.pop(i);
          }, i * 120));
          await EG.wait(first.length * 120 + 400);
        },
      };
    },
  };
})();
