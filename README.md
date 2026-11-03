# 転職先メモ

行きたい会社と、どの転職サイトで見ているかを記録する自分用のスマホアプリ（PWA）です。

- 記録する項目：会社名（必須）、利用サイト（複数可）、求人URL、メモ
- 会社ごとに面接・セミナー記録（聞かれたことと自分の答え、自分がした質問と返ってきた答え、感想メモ）を残せます
- メールアドレスとパスワードでログインすると、スマホとパソコンで同じデータを見られます（Firebase Authentication + Cloud Firestore）
- 圏外でも読み書きでき、つながると自動で同期されます
- データは本人しか読み書きできません（`firestore.rules`）
- 設定画面からバックアップの書き出し・読み込みができます

## 使い方（iPhone）

1. 公開URLを Safari で開く
2. 共有ボタン →「ホーム画面に追加」
3. ホーム画面のアイコンから起動

## Firebase の設定

1. Firebase コンソールでプロジェクトを作成
2. Authentication で「メール/パスワード」を有効にし、自分のユーザーを追加（アプリに新規登録画面はありません）
3. Firestore Database を作成し、ルールに `firestore.rules` の内容を貼って公開
4. ウェブアプリを登録し、表示された設定値を `js/firebase-config.js` に書く

## 開発

```sh
npm install
npm test              # データ処理のテスト
npm run build:vendor  # Firebase SDK を vendor/firebase.js にまとめ直す
npm start             # http://localhost:8000 で起動
```

`localhost` / `127.0.0.1` で開くと Firebase Emulator（Auth: 9099、Firestore: 8080）につながります。

ファイルを変更して公開するときは `sw.js` の `VERSION` を上げてください。
