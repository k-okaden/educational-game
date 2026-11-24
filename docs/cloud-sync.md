# クラウド同期の設定（Firebase）

同じ「かぞくコード」を入れたタブレット・スマホどうしで、ほし⭐の数を同期します。
保存先は Google の **Firebase**（無料プラン「Spark」で足ります）。
設定しない場合は、今までどおり端末の中だけに保存されます。

## 何が保存されるか

```
families/{かぞくコード}
  devices:
    d8k2m...: { stars: { counting: 12, add: 5 }, updatedAt: 1700000000000 }
    dq7xp...: { stars: { mul: 3 }, updatedAt: ... }
```

- ほしの数と更新時刻だけ。名前・メールアドレスなどの個人情報は送りません
- 端末ID・かぞくコードはランダムな文字列
- ログインは Firebase の「匿名ログイン」なので、アカウント登録は不要
- かぞくコードを知っている端末だけが読み書きできます（`firestore.rules`）。コードは他の人に見せないでください

## 設定手順（10分くらい）

1. https://console.firebase.google.com を開いて **プロジェクトを追加**
   - 名前は何でもOK（例：asobi-hiroba）
   - Google アナリティクスは **オフ** にする
2. 左のメニュー **構築 → Authentication → 始める**
   - 「ログイン方法」タブ → **匿名** → 有効にして保存
3. **構築 → Firestore Database → データベースを作成**
   - ロケーション：`asia-northeast1`（東京）
   - **本番環境モード** で開始
4. Firestore の **ルール** タブを開き、このリポジトリの [`firestore.rules`](../firestore.rules) の中身を全部貼りつけて **公開**
5. 左上の ⚙️ → **プロジェクトの設定** → 下の方の「マイアプリ」→ **ウェブ（`</>`）** を押してアプリを登録（Hosting は不要）
   - 表示される `firebaseConfig` の **apiKey** と **projectId** を [`shared/cloud-config.js`](../shared/cloud-config.js) に書く
     （Claude に頼む場合は、この2つの値を伝えればOK。どちらも公開前提の値で、パスワードではありません）
6. （おすすめ）APIキーを このサイトだけで使えるように制限する
   - https://console.cloud.google.com/apis/credentials → 同じプロジェクトを選ぶ → 「Browser key (auto created by Firebase)」
   - **アプリケーションの制限：ウェブサイト** → `https://k-okaden.github.io/*` を追加して保存

## 使い方

1. 1台目：⚙️「おうちのかたへ」→ ☁️ クラウドどうき → **あたらしく はじめる**
2. かぞくコードとQRコードが出る
3. 2台目：カメラでQRを読みとって開く（または ⚙️ からコードを入力して **つなぐ**）
4. あとは自動で同期（ほしが増えたとき・アプリを開いたとき）

- 「やめる」を押すと同期をやめます（その端末のほしは残ります）
- 「ほしを 0 にもどす」は、同期中なら全部の端末のほしを 0 にします
