# ローカル LLM 翻訳サービス

日本語の LaTeX 本文を OpenAI 互換 API で英訳する内部サービスです。LaTeX 構造を保護し、検証できない区間は原文を保持します。利用者の認証・プロジェクト権限確認は Overleaf 側で行う構成を想定しています。

取り込み元は `~/overleaf` の Shunsuke Ito による実装（`7bfcddc`）と修正（`23aa191`、`4d6221f`、`c69429b`）です。改行保護は `e0984cf` の修正も反映しています。今回、コマンドの保護・接続解放・出力打ち切りの扱いを追加修正しています。

| 環境変数 | 用途・既定値 |
| --- | --- |
| `LOCAL_LLM_BASE_URL` | OpenAI 互換 API の URL（`/v1` まで）。必須 |
| `LOCAL_LLM_API_KEY` | API キー。未設定なら認証ヘッダーなし |
| `TRANSLATION_DB_PATH` | SQLite 保存先。`/data/translation.sqlite3` |
| `TRANSLATION_CHUNK_CHARS` | 分割の目安文字数。`3600`（最小 `1000`） |
| `TRANSLATION_MAX_DOCUMENT_CHARS` | 原文の上限文字数。`500000` |
| `LOCAL_LLM_MAX_CONCURRENT_REQUESTS` | LLM の同時要求数。`2` |

`GET /health`、`GET /models`、`GET/PUT /projects/{id}/settings`、`POST /projects/{id}/translate` を提供します。翻訳は SSE で返し、`complete.failed_chunks` が空でなければ一部が原文のままです。

## ビルド・検証

リポジトリのルートで実行します。テストは模擬 LLM を使い、外部へ接続しません。

```sh
docker build -t local/overleaf-iisec-translation:review translation-service
docker run --rm --network none \
  --env TRANSLATION_DB_PATH=/tmp/translation-tests.sqlite3 \
  --mount "type=bind,src=$(pwd)/translation-service/tests,dst=/app/tests,readonly" \
  local/overleaf-iisec-translation:review python -m unittest discover -s tests -v
```

実運用では Overleaf と同じ内部ネットワークから接続し、`/data` を永続化します。本サービスには利用者認証がないため、外部公開はしません。Overleaf 側のモジュールと起動設定は別途取り込みます。
