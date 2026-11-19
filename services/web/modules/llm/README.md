# LLM 設定・チャット

管理者の共有接続と、許可された利用者の個人接続を使う AI チャットです。
OpenAI・Anthropic・OpenAI 互換 API に対応します。

`LLM_ENABLED=true` と `LLM_KEY_SECRET` を設定し、管理画面の
「LLM Configuration」から接続先と利用モデルを保存してください。
個人接続の登録には `LLM_ALLOW_USER_SETTINGS=true` も必要です。
秘密値は `openssl rand -hex 32` などで生成し、継続して同じ値を使います。
API キーは暗号化して保存し、設定画面・JSON API に返しません。

エディター左側の「AI Assistant」でモデル選択・送信・停止・再実行ができます。
送信時に編集中の本文を最大20,000文字、選択範囲を最大8,000文字添付します。
入力欄のチェックを外すと編集中の本文を添付しません。
プロジェクトの保存済みソースの参照は、アカウントメニューの「LLM Settings」で
自動・全体・参照なしと文字数予算を選びます。回答には実際に送信した参照ファイルを表示します。
接続先に送られるソースの範囲を確認して利用してください。
回答は確認・コピーして手作業で反映します。

共有接続の設定は `/var/lib/overleaf/data/llm-admin-settings.json`、
個人接続・モデル選択・参照設定と使用量は MongoDB に保存します。
翻訳サービスの接続設定は従来どおり独立しています。

基本テスト（開発依存導入済みの `services/web` 内で実行）:

```sh
node --test modules/llm/app/test/*.test.mjs
yarn test:llm-ui
```
