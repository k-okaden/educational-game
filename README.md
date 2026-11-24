# あそびのひろば 🧱

4さい〜向けの、**かず・えいご・けいさん** の知育ゲーム集です。
タブレットのブラウザで動くウェブアプリ（iPad / Android / Fire どれでもOK）。
ビルド不要・ライブラリ不要の素の HTML/CSS/JS なので、ファイルを足すだけでゲームを増やせます。

## いまあるゲーム

| ゲーム | 内容 |
| --- | --- |
| 🧱 かぞえよう | ブロックを数える／英語の数字を聞いて選ぶ／タップして英語で数える（1〜10・1〜20） |
| ➕ たしざん | 2色のブロックを合体させて足し算（5まで・10まで・20まで） |
| ➖ ひきざん | ✖ がついたブロックが飛んでいって、のこりを数える |
| ✖️ かけざん | 「◯こずつが△つぶん」のブロックの列。正解すると「2, 4, 6…」ととびかぞえ |

- 数字・式はすべて **英語で読み上げ**（"three plus two equals five!"）
- まちがえてもペナルティなし。正解でほし⭐がたまる
- 一度ひらけば **オフラインでも遊べる**（ホーム画面に追加するとアプリっぽく全画面で起動）
- **クラウド同期**（任意）：同じ「かぞくコード」の端末どうしで ⭐ を共有。設定は [docs/cloud-sync.md](docs/cloud-sync.md)

## タブレットで遊ぶ（GitHub Pages）

1. GitHub のリポジトリで **Settings → Pages**
2. Source を **Deploy from a branch**、Branch を **main / (root)** にして Save
3. 数分後に `https://<ユーザー名>.github.io/educational-game/` で公開される
4. タブレットでひらいて **「ホーム画面に追加」**
   - iPad（Safari）：共有ボタン → ホーム画面に追加
   - Android（Chrome）：︙ → ホーム画面に追加

> 英語の読み上げは端末の音声合成を使います。声が出ないときは、端末の設定で英語（English US）の音声をダウンロードしてください。

## 手元で動かす

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

`index.html` をダブルクリックしても動きます（オフライン機能だけは http で開いたときのみ）。

## 構成

```
index.html            ハブ（トップ画面）。registry.js を読んでカードを並べる
games/registry.js     ゲーム一覧 ← 新しいゲームはここに登録
games/<id>/           ゲームごとのフォルダ
games/_template/      新しいゲームのひな形
shared/core.css       共通の見た目（ボタン、ブロック、ごほうび画面）
shared/core.js        共通の機能（読み上げ、効果音、ほし、ブロック描画、紙ふぶき）
shared/cloud.js       クラウド同期（cloud-config.js に設定があるときだけ読み込む）
shared/vendor/        同梱ライブラリ（QRコード生成：qrcode-generator, MIT）
firestore.rules       クラウド同期用の Firestore セキュリティルール
sw.js                 オフライン対応
```

## ゲームの増やし方

1. `games/_template` をコピーして `games/<新しいid>/` を作る
2. 中身を書きかえる（`EG.*` の共通機能が使えます）
3. `games/registry.js` に1行追加

```js
{ id: "clock", title: "とけい", sub: "What time?", emoji: "⏰", color: "#ff6fa5", href: "games/clock/index.html", tags: ["とけい"] },
```

### 共通機能 `EG` の主なもの

| 関数 | 説明 |
| --- | --- |
| `EG.mountHeader({ title })` | 🏠ボタン・タイトル・⭐数のヘッダー |
| `EG.say(text, "en" \| "ja")` | 読み上げ（Promise） |
| `EG.numberWord(n)` / `EG.sayNumber(n)` | 7 → "seven" |
| `EG.sfx.tap/correct/wrong/fanfare/pop(i)` | 効果音（音声ファイル不要） |
| `EG.renderBlocks(el, [{count, color}], opt)` | ブロックを5こずつ並べる |
| `EG.renderChoices(el, choices, answer, {onCorrect})` | 大きな選択肢ボタン |
| `EG.makeChoices(answer, n, min, max)` | 正解の近くの数で選択肢を作る |
| `EG.stars.add(gameId)` | ⭐を追加（端末に保存） |
| `EG.showReward({ onAgain })` | ごほうび画面＋紙ふぶき |

### 大きなゲームを別リポジトリで作りたいとき

`registry.js` の `href` には外部URLも書けます。
別リポジトリで作って GitHub Pages に置き、ここから `href: "https://<user>.github.io/<repo>/"` でリンクすればハブから起動できます。

## アイデアメモ（これから増やせそう）

- 🔟 10のまとまり（10といくつ）
- 🔢 数字なぞり書き
- ⏰ とけい（What time is it?）
- 🍎 英単語カード（色・どうぶつ・くだもの）
- ➗ わりざん（おすそわけ）
- 🧩 かたち・パターン
