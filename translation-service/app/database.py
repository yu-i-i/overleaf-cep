"""翻訳サービスの永続化（SQLite）を担う薄いラッパーです。

保存するのは次の 3 種類だけで、原文の全文履歴は残しません。

- project_settings : プロジェクト単位の用語集・使用モデル・文体メモ（JSON）
- translation_memory : 直近 3 件の翻訳メモ（原文・訳文の末尾それぞれ 700 文字）
- llm_endpoints : 管理者が登録する名前付き接続先（キーは内部利用のみ）

DB ファイルは compose の named volume（/data/translation.sqlite3）に置き、
コンテナ再作成でも失われません。
"""

from __future__ import annotations

import json
import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any


class TranslationDatabase:
    """プロジェクト設定と翻訳メモを保存する SQLite クライアントです。"""

    def __init__(self, path: str | None = None) -> None:
        # 既定の保存先は翻訳サービス専用 volume。TEST でパス注入もできます。
        self.path = Path(path or os.getenv("TRANSLATION_DB_PATH", "/data/translation.sqlite3"))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                """CREATE TABLE IF NOT EXISTS project_settings (
                    project_id TEXT PRIMARY KEY,
                    settings_json TEXT NOT NULL
                )"""
            )
            connection.execute(
                """CREATE TABLE IF NOT EXISTS translation_memory (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id TEXT NOT NULL,
                    source_excerpt TEXT NOT NULL,
                    target_excerpt TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )"""
            )
            # 「プロジェクトの直近 N 件」取得を速くするための補助インデックスです。
            connection.execute(
                "CREATE INDEX IF NOT EXISTS translation_memory_project ON translation_memory(project_id, id DESC)"
            )

            # 接続先は共有設定ですが、どれを使うかはプロジェクト設定に保存します。
            connection.execute(
                """CREATE TABLE IF NOT EXISTS llm_endpoints (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    base_url TEXT NOT NULL,
                    api_key TEXT NOT NULL DEFAULT '',
                    extra_params TEXT NOT NULL DEFAULT '{}',
                    is_default INTEGER NOT NULL DEFAULT 0,
                    minimal_prompt INTEGER NOT NULL DEFAULT 0,
                    chunk_chars INTEGER,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )"""
            )
            # 既存 DB は不足する列だけ追加します。列重複以外の障害は握り潰しません。
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(llm_endpoints)")}
            for name, definition in (("minimal_prompt", "INTEGER NOT NULL DEFAULT 0"), ("chunk_chars", "INTEGER")):
                if name not in columns:
                    connection.execute(f"ALTER TABLE llm_endpoints ADD COLUMN {name} {definition}")
            connection.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS llm_endpoint_single_default "
                "ON llm_endpoints(is_default) WHERE is_default = 1"
            )

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        """トランザクション完了後、例外時も必ず接続を閉じます。"""
        connection = sqlite3.connect(self.path, timeout=10)
        try:
            connection.row_factory = sqlite3.Row
            # SQLite の with は commit / rollback のみで、close は行いません。
            # 接続を明示的に閉じ、リクエストごとのファイル記述子の滞留を防ぎます。
            with connection:
                yield connection
        finally:
            connection.close()

    def get_settings(self, project_id: str) -> dict[str, Any]:
        """プロジェクトの翻訳設定を返します。未保存なら既定値を返します。"""
        with self._connect() as connection:
            row = connection.execute(
                "SELECT settings_json FROM project_settings WHERE project_id = ?",
                (project_id,),
            ).fetchone()
        if row is None:
            return {"terms": [], "model": None, "context": "", "prompt_instructions": ""}
        return json.loads(row["settings_json"])

    def put_settings(self, project_id: str, settings: dict[str, Any]) -> None:
        """翻訳設定を追加または更新します（プロジェクトごとに 1 行）。"""
        payload = json.dumps(settings, ensure_ascii=False)
        with self._connect() as connection:
            connection.execute(
                """INSERT INTO project_settings(project_id, settings_json)
                   VALUES(?, ?)
                   ON CONFLICT(project_id) DO UPDATE SET settings_json = excluded.settings_json""",
                (project_id, payload),
            )

    def get_memory(self, project_id: str, limit: int = 3) -> list[dict[str, str]]:
        """直近の翻訳メモを古い順に返します（プロンプトの文体連続性用）。"""
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT source_excerpt, target_excerpt FROM translation_memory
                   WHERE project_id = ? ORDER BY id DESC LIMIT ?""",
                (project_id, limit),
            ).fetchall()
        return [
            {"source": row["source_excerpt"], "target": row["target_excerpt"]}
            for row in reversed(rows)
        ]

    def add_memory(self, project_id: str, source: str, target: str) -> None:
        """成功翻訳の末尾抜粋を 1 件追加し、直近 3 件より古いものを消します。

        全文を保存しないことで、ディスク肥大と機密情報の滞留を抑えます。
        """
        # Keep only a small amount of context from the latest successful candidate.
        source_excerpt = source[-700:]
        target_excerpt = target[-700:]
        with self._connect() as connection:
            connection.execute(
                """INSERT INTO translation_memory(project_id, source_excerpt, target_excerpt)
                   VALUES(?, ?, ?)""",
                (project_id, source_excerpt, target_excerpt),
            )
            connection.execute(
                """DELETE FROM translation_memory WHERE project_id = ? AND id NOT IN
                   (SELECT id FROM translation_memory WHERE project_id = ? ORDER BY id DESC LIMIT 3)""",
                (project_id, project_id),
            )

    def list_endpoints(self) -> list[dict[str, Any]]:
        """保存済みエンドポイントを全件返します（extra_params は辞書に復元済み）。"""
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM llm_endpoints ORDER BY is_default DESC, created_at ASC"
            ).fetchall()
        return [self._endpoint_dict(row) for row in rows]

    def get_endpoint(self, endpoint_id: str) -> dict[str, Any] | None:
        """ID で 1 件取得します。無ければ None です（API 応答用・キーは非公開）。"""
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM llm_endpoints WHERE id = ?", (endpoint_id,)
            ).fetchone()
        return self._endpoint_dict(row) if row else None

    def get_endpoint_credentials(
        self, endpoint_id: str
    ) -> tuple[str, str, dict[str, Any], bool, int | None] | None:
        """翻訳実行用に必要なので、キーの生値も含めて返します（内部専用）。

        戻り値は (base_url, api_key, extra_params, minimal_prompt, chunk_chars) です。
        """
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM llm_endpoints WHERE id = ?", (endpoint_id,)
            ).fetchone()
        if row is None:
            return None
        try:
            extra_params = json.loads(row["extra_params"])
        except ValueError:
            extra_params = {}
        return (
            row["base_url"],
            row["api_key"],
            extra_params if isinstance(extra_params, dict) else {},
            bool(row["minimal_prompt"]),
            row["chunk_chars"],
        )

    def get_default_endpoint_credentials(
        self,
    ) -> tuple[str, str, dict[str, Any], bool, int | None] | None:
        """標準エンドポイントの翻訳実行時値を返します（未設定なら None）。"""
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM llm_endpoints WHERE is_default = 1 LIMIT 1"
            ).fetchone()
        if row is None:
            return None
        try:
            extra_params = json.loads(row["extra_params"])
        except ValueError:
            extra_params = {}
        return (
            row["base_url"],
            row["api_key"],
            extra_params if isinstance(extra_params, dict) else {},
            bool(row["minimal_prompt"]),
            row["chunk_chars"],
        )

    def add_endpoint(
        self,
        endpoint_id: str,
        name: str,
        base_url: str,
        api_key: str,
        extra_params: dict[str, Any],
        make_default: bool = False,
        minimal_prompt: bool = False,
        chunk_chars: int | None = None,
    ) -> None:
        """エンドポイントを 1 件追加します。make_default で標準にします。"""
        with self._connect() as connection:
            if make_default:
                connection.execute("UPDATE llm_endpoints SET is_default = 0")
            connection.execute(
                """INSERT INTO llm_endpoints(id, name, base_url, api_key, extra_params,
                                             is_default, minimal_prompt, chunk_chars)
                   VALUES(?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    endpoint_id,
                    name,
                    base_url,
                    api_key,
                    json.dumps(extra_params, ensure_ascii=False),
                    1 if make_default else 0,
                    1 if minimal_prompt else 0,
                    chunk_chars,
                ),
            )

    def update_endpoint(
        self,
        endpoint_id: str,
        name: str,
        base_url: str,
        api_key: str,
        extra_params: dict[str, Any],
        minimal_prompt: bool = False,
        chunk_chars: int | None = None,
        *,
        clear_api_key: bool = False,
    ) -> bool:
        """同一 URL の更新だけキーを維持し、別 URL に保存済みキーを渡しません。"""
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute(
                "SELECT api_key, base_url FROM llm_endpoints WHERE id = ?", (endpoint_id,)
            ).fetchone()
            if existing is None:
                return False
            stored_key = "" if clear_api_key else api_key
            if not clear_api_key and not api_key and existing["base_url"] == base_url:
                stored_key = existing["api_key"]
            connection.execute(
                """UPDATE llm_endpoints
                   SET name = ?, base_url = ?, api_key = ?, extra_params = ?,
                       minimal_prompt = ?, chunk_chars = ?, updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?""",
                (
                    name,
                    base_url,
                    stored_key,
                    json.dumps(extra_params, ensure_ascii=False),
                    1 if minimal_prompt else 0,
                    chunk_chars,
                    endpoint_id,
                ),
            )
            return True

    def delete_endpoint(self, endpoint_id: str) -> None:
        """エンドポイントを 1 件削除します。"""
        with self._connect() as connection:
            connection.execute("DELETE FROM llm_endpoints WHERE id = ?", (endpoint_id,))

    def set_default_endpoint(self, endpoint_id: str) -> bool:
        """指定エンドポイントを標準にし、他を解除します（全体で 1 件のみ）。"""
        with self._connect() as connection:
            # 存在確認から標準切替までを同じ書き込みロック内で行います。
            # 同時削除された接続先の指定で、別の標準設定を消すことを防ぎます。
            connection.execute("BEGIN IMMEDIATE")
            if connection.execute("SELECT id FROM llm_endpoints WHERE id = ?", (endpoint_id,)).fetchone() is None:
                return False
            connection.execute("UPDATE llm_endpoints SET is_default = 0")
            connection.execute(
                "UPDATE llm_endpoints SET is_default = 1 WHERE id = ?", (endpoint_id,)
            )
            return True

    def clear_default_endpoint(self) -> None:
        """標準指定を解除します（未指定時は環境変数が使われます）。"""
        with self._connect() as connection:
            connection.execute("UPDATE llm_endpoints SET is_default = 0")

    @staticmethod
    def _endpoint_dict(row: sqlite3.Row) -> dict[str, Any]:
        """行を API 応答用の辞書にします（api_key の生値は has_api_key へ集約）。"""
        try:
            extra_params = json.loads(row["extra_params"])
        except ValueError:
            extra_params = {}
        return {
            "id": row["id"],
            "name": row["name"],
            "base_url": row["base_url"],
            "has_api_key": bool(row["api_key"]),
            "extra_params": extra_params if isinstance(extra_params, dict) else {},
            "is_default": bool(row["is_default"]),
            "minimal_prompt": bool(row["minimal_prompt"]),
            "chunk_chars": row["chunk_chars"],
        }


# アプリ全体で共有する単一の DB インスタンスです。
database = TranslationDatabase()
