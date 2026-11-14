"""翻訳サービスの永続化（SQLite）を担う薄いラッパーです。

保存するのは次の 2 種類だけで、原文の全文履歴は残しません。

- project_settings : プロジェクト単位の用語集・使用モデル・文体メモ（JSON）
- translation_memory : 直近 3 件の翻訳メモ（原文・訳文の末尾それぞれ 700 文字）

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
            return {"terms": [], "model": None, "context": ""}
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


# アプリ全体で共有する単一の DB インスタンスです。
database = TranslationDatabase()
