"""取り込み時のレビューで見つけた保護・停止・永続化の不具合を検証します。"""

import asyncio
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from app import main
from app.database import TranslationDatabase
from app.latex import MARKER_RE, protect_latex, restore_and_validate, split_chunks

PROJECT_ID = "b" * 24


class ProtectionRegressionTests(unittest.TestCase):
    def test_all_command_names_are_hidden_while_prose_remains_translatable(self):
        for source in (r"\textbf{日本語}", r"\section{日本語}", r"\custommacro 日本語"):
            with self.subTest(source=source):
                protected = protect_latex(source)
                self.assertNotIn("\\", protected.masked)
                translated = protected.masked.replace("日本語", "English")
                self.assertEqual(restore_and_validate(protected, translated), source.replace("日本語", "English"))

    def test_introducing_an_unbraced_command_is_rejected(self):
        protected = protect_latex("本文")
        with self.assertRaises(ValueError):
            restore_and_validate(protected, protected.masked + r"\relax")

    def test_special_tex_characters_are_preserved_and_cannot_be_introduced(self):
        protected = protect_latex("本文 & 列 #1 _ ^")
        self.assertEqual(restore_and_validate(protected, protected.masked), "本文 & 列 #1 _ ^")
        prose = protect_latex("本文")
        for suffix in (" & added", "_name", "^2", "#1"):
            with self.subTest(suffix=suffix), self.assertRaises(ValueError):
                restore_and_validate(prose, "English" + suffix)

    def test_comment_and_definition_line_endings_are_preserved(self):
        for prefix in ("% 原文のコメント\n\n", "\\newcommand{\\name}{original}\n\n"):
            with self.subTest(prefix=prefix):
                source = prefix + "日本語"
                protected = protect_latex(source)
                self.assertEqual(protected.tokens[0], prefix)
                translated = protected.masked.replace("日本語", "English").replace("\n", " ")
                self.assertEqual(restore_and_validate(protected, translated), prefix + "English")

    def test_literal_marker_strings_round_trip_without_collisions(self):
        source = "QZPROTECTED000000XZQ と $x$、QZPROTECTED000001XZQ を説明する。"
        protected = protect_latex(source)
        self.assertEqual(restore_and_validate(protected, protected.masked), source)

    def test_small_chunk_sizes_do_not_split_markers_or_stall(self):
        masked = "aQZPROTECTED000000XZQbQZPROTECTED000001XZQc"
        for size in (1, 2, 8, 18, 19, 20, 21):
            with self.subTest(size=size):
                chunks = split_chunks(masked, size)
                self.assertTrue(all(chunks))
                self.assertEqual("".join(chunks), masked)
                self.assertEqual([marker for chunk in chunks for marker in MARKER_RE.findall(chunk)], MARKER_RE.findall(masked))
        with self.assertRaises(ValueError):
            split_chunks(masked, 0)

    def test_translation_labels_do_not_remove_academic_prose(self):
        for text in ("Here is evidence for the claim.", "Translation improves the results.", "Translation: QZPROTECTED000000XZQ"):
            self.assertEqual(main._strip_model_boilerplate(text), text)

    def test_truncated_non_streaming_completion_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "truncated"):
            main._completion_content({"choices": [{"message": {"content": "Partial translation"}, "finish_reason": "length"}]})


class DatabaseRegressionTests(unittest.TestCase):
    def test_memory_retention_and_project_isolation_survive_reopening(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "translation.sqlite3")
            database = TranslationDatabase(path)
            database.put_settings(PROJECT_ID, {"model": "saved-model"})
            for index in range(5):
                database.add_memory(PROJECT_ID, str(index) * 800, str(index) * 900)
            database.add_memory("c" * 24, "other", "other")
            reopened = TranslationDatabase(path)
            self.assertEqual(reopened.get_settings(PROJECT_ID)["model"], "saved-model")
            self.assertEqual([item["source"] for item in reopened.get_memory(PROJECT_ID)], [str(index) * 700 for index in (2, 3, 4)])
            self.assertEqual(reopened.get_memory("c" * 24), [{"source": "other", "target": "other"}])

    def test_failed_transaction_rolls_back_and_closes_connection(self):
        with tempfile.TemporaryDirectory() as directory:
            database = TranslationDatabase(str(Path(directory) / "translation.sqlite3"))
            with self.assertRaisesRegex(RuntimeError, "abort"):
                with database._connect() as connection:
                    connection.execute("INSERT INTO project_settings VALUES (?, ?)", (PROJECT_ID, '{}'))
                    raise RuntimeError("abort")
            with self.assertRaises(sqlite3.ProgrammingError):
                connection.execute("SELECT 1")
            self.assertEqual(database.get_settings(PROJECT_ID)["terms"], [])


class HTTPRegressionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.database = TranslationDatabase(str(Path(self.directory.name) / "translation.sqlite3"))
        self.database_patch = patch.object(main, "database", self.database)
        self.database_patch.start()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://translation.test")

    async def asyncTearDown(self):
        await self.client.aclose()
        self.database_patch.stop()
        self.directory.cleanup()

    async def test_health_settings_validation_and_project_isolation(self):
        self.assertEqual((await self.client.get("/health")).json(), {"status": "ok"})
        response = await self.client.put(f"/projects/{PROJECT_ID}/settings", json={"model": "test-model", "terms": [{"source": " 用語 ", "target": "first"}, {"source": "用語", "target": "term"}]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["terms"], [{"source": "用語", "target": "term"}])
        loaded = (await self.client.get(f"/projects/{PROJECT_ID}/settings")).json()
        self.assertEqual({key: loaded[key] for key in response.json()}, response.json())
        self.assertIsNone((await self.client.get(f"/projects/{'c' * 24}/settings")).json()["model"])
        self.assertEqual((await self.client.get("/projects/invalid/settings")).status_code, 400)
        self.assertEqual((await self.client.put(f"/projects/{PROJECT_ID}/settings", json={"unexpected": 1})).status_code, 422)

    async def test_document_limit_and_missing_model_are_http_errors(self):
        response = await self.client.post(f"/projects/{PROJECT_ID}/translate", json={"text": "本文"})
        self.assertEqual(response.status_code, 409)
        with patch.object(main, "MAX_DOCUMENT_CHARS", 10):
            response = await self.client.post(f"/projects/{PROJECT_ID}/translate", json={"text": "あ" * 11, "model": "test-model"})
        self.assertEqual(response.status_code, 413)

    async def test_validated_translation_is_returned_as_sse_and_saved(self):
        async def completion(_model, messages, endpoint_id=None, **_options):
            fragment = messages[-1]["content"].split("<fragment>\n", 1)[1].rsplit("\n</fragment>", 1)[0]
            yield fragment.replace("日本語", "English")

        with (patch.object(main, "_get_models", new=AsyncMock(return_value=[{"id": "test-model"}])), patch.object(main, "_stream_chat_completion", new=completion)):
            response = await self.client.post(f"/projects/{PROJECT_ID}/translate", json={"text": r"\textbf{日本語} $x=1$", "model": "test-model"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["x-accel-buffering"], "no")
        events = [json.loads(frame[6:]) for frame in response.text.split("\n\n") if frame.startswith("data: ")]
        complete = next(event for event in events if event["type"] == "complete")
        self.assertEqual(complete["text"], r"\textbf{English} $x=1$")
        self.assertEqual(complete["failed_chunks"], [])
        self.assertEqual(self.database.get_memory(PROJECT_ID)[0]["target"], complete["text"])

    async def test_closing_response_after_delta_closes_upstream_generator(self):
        closed = asyncio.Event()

        async def completion(_model, _messages, endpoint_id=None, **_options):
            try:
                yield "English"
                await asyncio.Future()
            finally:
                closed.set()

        with (patch.object(main, "_get_models", new=AsyncMock(return_value=[{"id": "test-model"}])), patch.object(main, "_stream_chat_completion", new=completion)):
            response = await main.translate(PROJECT_ID, main.TranslationRequest(text="本文", model="test-model"))
            async for frame in response.body_iterator:
                if json.loads(frame[6:])["type"] == "delta":
                    break
            await response.body_iterator.aclose()
        self.assertTrue(closed.is_set())


if __name__ == "__main__":
    unittest.main()
