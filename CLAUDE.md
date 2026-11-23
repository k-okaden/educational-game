# Project notes

- 子ども（4歳）向けタブレット用知育ゲーム集。素の HTML/CSS/JS、ビルドなし。
- 新しいゲーム = `games/<id>/` フォルダ + `games/registry.js` に1エントリ。ひな形は `games/_template/`。
- 共通機能は `shared/core.js`（`window.EG`）と `shared/core.css` に置き、ゲーム側で重複実装しない。
- classic script（ES modules を使わない）。`file://` でも動くようにするため。
- UI ルール：タップ領域は最低 88px、文字はひらがな中心、英語は読み上げ併記、まちがいにペナルティなし。
- 既存の子ども番組・ゲームのキャラクターや見た目は使わない（オリジナルのデザインにする）。
