# 日本語から英語への翻訳

エディタの「英訳」ボタンから、現在の `.tex` 全体または選択範囲を翻訳します。全文の結果は同じフォルダーの `.en.tex` に保存し、選択範囲の結果は確認後に原文へ適用できます。翻訳中に原文を編集した場合は、結果の適用・保存を止めます。

取り込み元は `~/overleaf` の Shunsuke Ito による実装（`049b6a7`）と修正（`23aa191`、`4d6221f`、`c69429b`）です。Overleaf CE+ の拡張点と標準の保存処理を利用しています。

## 導入

リポジトリのルートで実行します。

```sh
cp .env.example .env
chmod 600 .env
openssl rand -base64 32
```

生成した値を `.env` の `OVERLEAF_INVITE_TOKEN_SECRET` に設定し、管理者メール・公開 URL・LLM 接続先を編集します。ホストで動く LLM は `http://host.docker.internal:<port>/v1` で指定できます。

```sh
./scripts/build-images.sh
docker compose -f compose.yaml up -d
docker compose -f compose.yaml exec --workdir /overleaf/services/web sharelatex \
  node modules/server-ce-scripts/scripts/create-user.mjs --admin --email=admin@example.com
```

表示された URL でパスワードを設定します。既定のアクセス先は `http://localhost:8080` です。初回のフル TeX Live ビルドは時間とディスク容量を使います。

## 利用

1. 書き込み権限のある `.tex` を開き、「英訳」を押します。
2. モデル・翻訳対象・必要なら用語集を指定して翻訳します。
3. プレビューを確認し、英語版として保存するか、選択範囲へ適用します。

「保存して英語版をメイン文書に設定」の後は、コンパイルして英語版 PDF を生成します。一部を翻訳できなかった場合は原文を保持し、画面に対象チャンクを表示します。

翻訳サービスと DB はホストへ公開しません。LLM の API キーは翻訳サービスにだけ渡します。この構成は信頼できる研究室内の利用者を対象とし、Sandboxed Compiles や Git ブリッジなどの追加サービスは含みません。
