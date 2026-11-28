/*
 * ゲーム一覧（ハブ画面に表示されるカード）
 * 新しいゲームを作ったら、ここに1行足すだけでトップに並びます。
 *
 *   id      : ほしの記録に使うID（英数字）
 *   title   : カードの名前
 *   sub     : 小さい説明
 *   emoji   : アイコン（絵文字）
 *   symbol  : 絵文字のかわりに大きな白い文字を出す（"+" など）
 *   color   : カードの色
 *   href    : ゲームのURL（このファイルからではなく、トップの index.html からの相対パス）
 *   tags    : 分類（"かず" "えいご" など。将来の絞り込み用）
 *   hidden  : true にすると一覧に出ない（作りかけのとき用）
 */
window.EG_GAMES = [
  {
    id: "counting",
    title: "かぞえよう",
    sub: "Count! 1・2・3",
    emoji: "🧱",
    color: "#4f8ff7",
    href: "games/counting/index.html",
    tags: ["かず", "えいご"],
  },
  {
    id: "add",
    title: "たしざん",
    sub: "plus ＋",
    symbol: "+",
    color: "#ff9f43",
    href: "games/math-blocks/index.html?op=add",
    tags: ["かず", "けいさん"],
  },
  {
    id: "sub",
    title: "ひきざん",
    sub: "minus −",
    symbol: "−",
    color: "#2ecc71",
    href: "games/math-blocks/index.html?op=sub",
    tags: ["かず", "けいさん"],
  },
  {
    id: "mul",
    title: "かけざん",
    sub: "times ×",
    symbol: "×",
    color: "#a66cff",
    href: "games/math-blocks/index.html?op=mul",
    tags: ["かず", "けいさん"],
  },
  {
    id: "div",
    title: "わりざん",
    sub: "divided by ÷",
    symbol: "÷",
    color: "#1abc9c",
    href: "games/math-blocks/index.html?op=div",
    tags: ["かず", "けいさん"],
  },
];
