"""翻訳サービスの回帰テスト集です。

実行方法（このリポジトリの translation-service ディレクトリで）:

    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python -m unittest discover -s tests

テストは実際の LLM を呼ばず、httpx 部分を偽装（Fake クラス）して、
モデル一覧取得・SSE ストリーム・LaTeX 保護と検証・チャンク分割・
クライアント停止の扱いなどを検証します。
"""

from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app import main
from app.database import TranslationDatabase
from app.latex import MARKER_RE, protect_latex, restore_and_validate, split_chunks
from fastapi.responses import StreamingResponse


PROJECT_ID = "a" * 24
MODEL_ID = "local-test-model"


# /models 応答の解析と、不正な項目の除外を検証します。
class ModelDiscoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_openai_compatible_models_endpoint_is_loaded_with_server_key(self) -> None:
        observed: dict[str, object] = {}

        class FakeResponse:
            def raise_for_status(self) -> None:
                return None

            def json(self) -> dict[str, object]:
                return {"data": [{"id": "paper-model"}, {"id": 3}, "invalid"]}

        class FakeClient:
            def __init__(self, timeout: float | None) -> None:
                observed["timeout"] = timeout

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args) -> None:
                return None

            async def get(self, url: str, headers: dict[str, str]) -> FakeResponse:
                observed["url"] = url
                observed["headers"] = headers
                return FakeResponse()

        with (
            patch.object(main, "BASE_URL", "http://llm.example/v1"),
            patch.object(main, "API_KEY", "test-only-key"),
            patch.object(main.httpx, "AsyncClient", FakeClient),
        ):
            self.assertEqual(await main._get_models(), [{"id": "paper-model"}])

        self.assertEqual(observed["url"], "http://llm.example/v1/models")
        self.assertIsNone(observed["timeout"])
        self.assertEqual(
            observed["headers"],
            {"Accept": "application/json", "Authorization": "Bearer test-only-key"},
        )


# OpenAI 互換 SSE ストリームの解析（本文テキストだけを歩む・タイムアウトなし）を検証します。
class OpenAIStreamingTests(unittest.IsolatedAsyncioTestCase):
    async def test_streaming_completion_has_no_timeout_and_forwards_only_text(self) -> None:
        observed: dict[str, object] = {}

        class FakeResponse:
            headers = {"content-type": "text/event-stream"}

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args) -> None:
                return None

            def raise_for_status(self) -> None:
                return None

            async def aiter_lines(self):
                yield 'data: {"choices":[{"delta":{"reasoning_content":"private reasoning"}}]}'
                yield 'data: {"choices":[{"delta":{"content":"The trust "}}]}'
                yield 'data: {"choices":[{"delta":{"content":"boundary."}}]}'
                # 「delta」キーが空でも「message」へ退避せず、全文の二重配信をしません。
                yield 'data: {"choices":[{"delta":{},"message":{"content":"The trust boundary."}}]}'
                yield "data: [DONE]"

        class FakeClient:
            def __init__(self, timeout: float | None) -> None:
                observed["timeout"] = timeout

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args) -> None:
                return None

            def stream(self, method: str, url: str, **kwargs):
                observed["method"] = method
                observed["url"] = url
                observed["payload"] = kwargs["json"]
                return FakeResponse()

        with (
            patch.object(main, "BASE_URL", "http://llm.example/v1"),
            patch.object(main.httpx, "AsyncClient", FakeClient),
        ):
            pieces = [
                piece
                async for piece in main._stream_chat_completion(
                    MODEL_ID, [{"role": "user", "content": "translate"}]
                )
            ]

        self.assertIsNone(observed["timeout"])
        self.assertEqual(observed["method"], "POST")
        self.assertEqual(observed["url"], "http://llm.example/v1/chat/completions")
        self.assertTrue(observed["payload"]["stream"])
        self.assertEqual("".join(pieces), "The trust boundary.")


# protect_latex / restore_and_validate の保護対象と再検証を検証します。
class LatexProtectionTests(unittest.TestCase):
    def test_commands_comments_math_and_code_remain_exact(self) -> None:
        source = (
            r"図\ref{fig:architecture}にシステム構成を示す。"
            "\n"
            r"先行研究\cite{example2026}を参照する。 % \ref{comment:must-stay}"
            "\n"
            r"$x = y + 1$ と定義する。"
            "\n"
            r"\begin{align} x &= y + 1 \end{align}"
            "\n"
            r"\begin{lstlisting}[language=Python]"
            "print('日本語')\n"
            r"\end{lstlisting}"
        )
        protected = protect_latex(source)
        self.assertEqual(len(protected.tokens), len(MARKER_RE.findall(protected.masked)))
        restored = restore_and_validate(protected, protected.masked)
        self.assertEqual(source, restored)
        for exact in (
            r"\ref{fig:architecture}",
            r"\cite{example2026}",
            "% \\ref{comment:must-stay}\n",
            r"$x = y + 1$",
            r"\begin{align} x &= y + 1 \end{align}",
        ):
            self.assertIn(exact, protected.tokens)
        self.assertTrue(
            any(token.startswith(r"\begin{lstlisting}") and token.endswith(r"\end{lstlisting}") for token in protected.tokens)
        )

    def test_hyperlink_url_is_frozen_but_display_text_is_translatable(self) -> None:
        source = r"\href{https://example.org/paper.pdf}{論文を読む}"
        protected = protect_latex(source)
        self.assertEqual(len(protected.tokens), 2)
        self.assertEqual(protected.tokens[0], r"\href{https://example.org/paper.pdf}{")
        self.assertIn("論文を読む", protected.masked)

    def test_environment_options_are_frozen_but_body_remains_translatable(self) -> None:
        source = r"\begin{enumerate}[label={\alph*)}]項目\end{enumerate}"
        protected = protect_latex(source)
        self.assertEqual(protected.tokens[0], r"\begin{enumerate}[label={\alph*)}]")
        self.assertIn("項目", protected.masked)
        self.assertEqual(restore_and_validate(protected, protected.masked), source)

    def test_raw_url_and_filename_do_not_capture_adjacent_japanese(self) -> None:
        source = "文書main.texを編集し，https://example.org/paper.pdfを参照する。"
        protected = protect_latex(source)
        self.assertIn("main.tex", protected.tokens)
        self.assertIn("https://example.org/paper.pdf", protected.tokens)
        self.assertIn("を参照する。", protected.masked)

    def test_changed_or_new_structure_is_rejected(self) -> None:
        source = r"図\ref{fig:architecture}に示す。"
        protected = protect_latex(source)
        with self.assertRaisesRegex(ValueError, "changed or removed"):
            restore_and_validate(protected, protected.masked.replace("QZPROTECTED000000XZQ", ""))
        with self.assertRaisesRegex(ValueError, "introduced, removed, or altered"):
            restore_and_validate(protected, protected.masked + "{broken}")


# モデルが訳文の前後に付ける定型のメタ発言・コードフェンスの除去を検証します。
class ModelBoilerplateTests(unittest.TestCase):
    def test_preamble_note_and_code_fences_are_removed(self) -> None:
        text = (
            "Sure! Here is the translated fragment:\n\n"
            "This study examines the boundary.\n\n"
            "Note: the markers are preserved."
        )
        self.assertEqual(
            main._strip_model_boilerplate(text),
            "This study examines the boundary.",
        )
        fenced = "```latex\nThis study examines the boundary.\n```"
        self.assertEqual(
            main._strip_model_boilerplate(fenced),
            "This study examines the boundary.",
        )

    def test_academic_prose_is_never_stripped(self) -> None:
        text = (
            "Note that the trust boundary is critical.\n"
            "Here, we evaluate the pipeline and report the results."
        )
        self.assertEqual(main._strip_model_boilerplate(text), text)

    def test_chunk_edge_spacing_is_restored(self) -> None:
        # モデルが端の空白を落としても、元チャンクの境界空白を補って結合する。
        self.assertEqual(main._preserve_chunk_edge_spacing("www. ", "www."), "www. ")
        self.assertEqual(main._preserve_chunk_edge_spacing(" example.org", "example.org"), " example.org")
        self.assertEqual(main._preserve_chunk_edge_spacing("www. ", "www. "), "www. ")
        # 端がマーカーや本文のチャンクでは何も補わない。
        self.assertEqual(main._preserve_chunk_edge_spacing("QZ", "translated"), "translated")


# 翻訳ストリーム全体（翻訳→検証→再試行→完了/停止）の振る舞いを、
# 偽装 LLM と一時 SQLite を使って検証します。
class TranslationFlowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.previous_database = main.database
        main.database = TranslationDatabase(str(Path(self.tempdir.name) / "translation.sqlite3"))
        self.prompts: list[list[dict[str, str]]] = []
        self.events: list[dict[str, object]] = []

    async def asyncTearDown(self) -> None:
        main.database = self.previous_database
        self.tempdir.cleanup()

    async def _translate(
        self, source: str, *, corrupt_third_large_chunk: bool = False
    ):
        completion_calls = 0

        async def fake_completion(model, messages):
            nonlocal completion_calls
            completion_calls += 1
            self.prompts.append(messages)
            prompt = messages[-1]["content"]
            fragment = prompt.split("<fragment>\n", 1)[1].rsplit("\n</fragment>", 1)[0]
            replacements = {
                "本研究では，CI/CDパイプラインにおける信頼境界について検討する．":
                    "This study examines the trust boundary in a CI/CD pipeline.",
                "図": "Figure~",
                "にシステム構成を示す．": " shows the system architecture.",
                "この問題は先行研究": "Prior work ",
                "でも指摘されている．": " also pointed out this issue.",
                "と定義する．": " is defined.",
                "第一段落です。": "This is the first paragraph.",
                "第二段落です。": "This is the second paragraph.",
                "本研究では信頼境界を検討する。":
                    "This study examines the trust boundary.",
            }
            for japanese, english in replacements.items():
                fragment = fragment.replace(japanese, english)
            if corrupt_third_large_chunk and completion_calls == 3 and len(fragment) > 2000:
                marker = MARKER_RE.search(fragment)
                if marker:
                    fragment = fragment[: marker.start()] + fragment[marker.end() :]
            midpoint = max(1, len(fragment) // 2)
            yield fragment[:midpoint]
            yield fragment[midpoint:]

        with (
            patch.object(main, "_get_models", new=AsyncMock(return_value=[{"id": MODEL_ID}])),
            patch.object(main, "_stream_chat_completion", new=fake_completion),
        ):
            response = await main.translate(
                PROJECT_ID, main.TranslationRequest(text=source, model=MODEL_ID)
            )
            self.assertIsInstance(response, StreamingResponse)
            body_parts = []
            async for part in response.body_iterator:
                body_parts.append(part.decode() if isinstance(part, bytes) else part)

        body = "".join(body_parts)
        self.events = [
            json.loads(frame.removeprefix("data: "))
            for frame in body.split("\n\n")
            if frame.startswith("data: ")
        ]
        complete = next(event for event in self.events if event["type"] == "complete")
        return complete

    async def test_normal_prose_and_reference_keep_expected_latex(self) -> None:
        source = "本研究では，CI/CDパイプラインにおける信頼境界について検討する．"
        reply = await self._translate(source)
        self.assertEqual(
            reply["text"],
            "This study examines the trust boundary in a CI/CD pipeline.",
        )

        source = r"図\ref{fig:architecture}にシステム構成を示す．"
        reply = await self._translate(source)
        self.assertEqual(
            reply["text"],
            r"Figure~\ref{fig:architecture} shows the system architecture.",
        )

    async def test_citation_math_and_multiple_paragraphs_are_preserved(self) -> None:
        citation = r"この問題は先行研究\cite{example2026}でも指摘されている．"
        self.assertEqual(
            (await self._translate(citation))["text"],
            r"Prior work \cite{example2026} also pointed out this issue.",
        )
        math = r"$x = y + 1$ と定義する．"
        self.assertEqual((await self._translate(math))["text"], r"$x = y + 1$ is defined.")

        paragraphs = "第一段落です。\n\n第二段落です。"
        self.assertEqual(
            (await self._translate(paragraphs))["text"],
            "This is the first paragraph.\n\nThis is the second paragraph.",
        )

    async def test_long_document_uses_glossary_and_recent_chunk_context(self) -> None:
        main.database.put_settings(
            PROJECT_ID,
            {
                "terms": [{"source": "信頼境界", "target": "trust boundary"}],
                "model": MODEL_ID,
                "context": "Security paper. Use concise academic prose.",
            },
        )
        source = "\n\n".join("本研究では信頼境界を検討する。" for _ in range(240))
        reply = await self._translate(source)
        self.assertGreater(reply["chunks"], 1)
        self.assertEqual(reply["text"].count("trust boundary"), 240)
        self.assertTrue(
            all("信頼境界 -> trust boundary" in prompt[-1]["content"] for prompt in self.prompts)
        )
        self.assertTrue(
            any("Immediately preceding translated chunk" in prompt[-1]["content"] for prompt in self.prompts)
        )
        self.assertTrue(any(event["type"] == "delta" for event in self.events))
        self.assertTrue(any(event["type"] == "chunk_complete" for event in self.events))
        progress = [event for event in self.events if event["type"] == "progress"]
        self.assertTrue(
            any(
                event["phase"] == "generating" and event["total"] > 1
                for event in progress
            )
        )

    async def test_protection_mismatch_retries_the_chunk_in_smaller_ranges(self) -> None:
        source = "\n\n".join("日本語$x=1$の説明です。" for _ in range(600))

        reply = await self._translate(source, corrupt_third_large_chunk=True)

        self.assertEqual(reply["text"], source)
        self.assertGreater(reply["chunks"], 4)
        self.assertTrue(
            any(
                event["type"] == "progress" and event["phase"] == "retrying"
                for event in self.events
            )
        )

    async def test_chunk_with_exhausted_retries_keeps_original_and_completes(self) -> None:
        """検証失敗が続くチャンクは原文保持とし、文書全体の翻訳は止めない。"""
        source = "\n\n".join("この式$x_i=1$を検討する。" for _ in range(3))

        async def corrupting_completion(_model, messages):
            """常に最初の保護マーカーを消して、検証を確実に失敗させる。"""
            fragment = messages[-1]["content"].split("<fragment>\n", 1)[1].rsplit("\n</fragment>", 1)[0]
            marker = MARKER_RE.search(fragment)
            if marker:
                fragment = fragment[: marker.start()] + fragment[marker.end():]
            yield fragment

        with (
            patch.object(main, "_get_models", new=AsyncMock(return_value=[{"id": MODEL_ID}])),
            patch.object(main, "_stream_chat_completion", new=corrupting_completion),
        ):
            response = await main.translate(
                PROJECT_ID, main.TranslationRequest(text=source, model=MODEL_ID)
            )
            body_parts = []
            async for part in response.body_iterator:
                body_parts.append(part.decode() if isinstance(part, bytes) else part)

        body = "".join(body_parts)
        events = [
            json.loads(frame.removeprefix("data: "))
            for frame in body.split("\n\n")
            if frame.startswith("data: ")
        ]
        complete = next(event for event in events if event["type"] == "complete")
        self.assertEqual(complete["text"], source)
        self.assertEqual(complete["failed_chunks"], [1])
        self.assertTrue(
            any(
                event["type"] == "progress" and event["phase"] == "keeping_original"
                for event in events
            )
        )
        self.assertTrue(
            any(event["type"] == "chunk_complete" and event.get("ok") is False for event in events)
        )

    async def test_document_validation_reverts_only_chunks_with_new_latex(self) -> None:
        """モデルが新規コマンドを足しても文書を捨てず、そのチャンクだけ原文へ戻す。"""
        source = "\n\n".join("本研究では信頼境界を検討する。" for _ in range(300))
        completion_calls = 0

        async def inflating_completion(_model, messages):
            """1 つ目のチャンクで \\textbf を追加し、チャンク検証だけ通すようにする。"""
            nonlocal completion_calls
            completion_calls += 1
            fragment = messages[-1]["content"].split("<fragment>\n", 1)[1].rsplit("\n</fragment>", 1)[0]
            translation = "This study examines the trust boundary."
            if completion_calls == 1:
                translation = r"\textbf{" + translation + "}"
            yield fragment.replace("本研究では信頼境界を検討する。", translation)

        with (
            patch.object(main, "_get_models", new=AsyncMock(return_value=[{"id": MODEL_ID}])),
            patch.object(main, "_stream_chat_completion", new=inflating_completion),
        ):
            response = await main.translate(
                PROJECT_ID, main.TranslationRequest(text=source, model=MODEL_ID)
            )
            body_parts = []
            async for part in response.body_iterator:
                body_parts.append(part.decode() if isinstance(part, bytes) else part)

        body = "".join(body_parts)
        events = [
            json.loads(frame.removeprefix("data: "))
            for frame in body.split("\n\n")
            if frame.startswith("data: ")
        ]
        complete = next(event for event in events if event["type"] == "complete")
        self.assertGreater(complete["chunks"], 1)
        # ねつ造したチャンクだけ原文へ戻り、他のチャンクの訳文は残る。
        self.assertEqual(complete["failed_chunks"], [1])
        self.assertNotIn(r"\textbf{", complete["text"])
        self.assertIn("本研究では信頼境界を検討する。", complete["text"])
        self.assertGreater(complete["text"].count("This study examines the trust boundary."), 100)
        self.assertTrue(
            any(
                event["type"] == "progress" and event["phase"] == "salvaging"
                for event in events
            )
        )
        # 原文保持が混じるため、翻訳メモ（文体メモ）の更新は見送られる。
        self.assertEqual(main.database.get_memory(PROJECT_ID), [])

    async def test_chunk_boundary_spaces_are_restored_after_llm_trims(self) -> None:
        """LLM が境界空白を落としてもチャンク境界の単語を融合させない。"""
        # 3600 文字境界で "www." | " example.org" と割れ、結合時に URL 誤検出しうる。
        source = "あ" * 3596 + "www." + " example.org" + "を説明する。"

        async def identity_completion(_model, messages):
            fragment = messages[-1]["content"].split("<fragment>\n", 1)[1].rsplit("\n</fragment>", 1)[0]
            yield fragment

        with (
            patch.object(main, "_get_models", new=AsyncMock(return_value=[{"id": MODEL_ID}])),
            patch.object(main, "_stream_chat_completion", new=identity_completion),
        ):
            response = await main.translate(
                PROJECT_ID, main.TranslationRequest(text=source, model=MODEL_ID)
            )
            body_parts = []
            async for part in response.body_iterator:
                body_parts.append(part.decode() if isinstance(part, bytes) else part)

        body = "".join(body_parts)
        events = [
            json.loads(frame.removeprefix("data: "))
            for frame in body.split("\n\n")
            if frame.startswith("data: ")
        ]
        complete = next(event for event in events if event["type"] == "complete")
        self.assertGreater(complete["chunks"], 1)
        self.assertEqual(complete["failed_chunks"], [])
        self.assertNotIn("www.example.org", complete["text"])

    async def test_client_cancellation_closes_the_local_llm_stream(self) -> None:
        started = asyncio.Event()
        closed = asyncio.Event()

        async def blocked_completion(_model, _messages):
            started.set()
            try:
                await asyncio.Future()
                yield "unreachable"
            finally:
                closed.set()

        async def consume():
            async for _event in main._stream_with_progress(
                MODEL_ID, [], chunk_number=1, total_chunks=1
            ):
                pass

        with patch.object(main, "_stream_chat_completion", new=blocked_completion):
            task = asyncio.create_task(consume())
            await started.wait()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        self.assertTrue(closed.is_set())

    async def test_waiting_model_sends_progress_and_stays_cancellable(self) -> None:
        closed = asyncio.Event()

        async def blocked_completion(_model, _messages):
            try:
                await asyncio.Future()
                yield "unreachable"
            finally:
                closed.set()

        with (
            patch.object(main, "PROGRESS_INTERVAL_SECONDS", 0.001),
            patch.object(main, "_stream_chat_completion", new=blocked_completion),
        ):
            stream = main._stream_with_progress(
                MODEL_ID, [], chunk_number=2, total_chunks=5
            )
            event = await anext(stream)
            await stream.aclose()

        self.assertEqual(event["type"], "progress")
        self.assertEqual(event["phase"], "waiting")
        self.assertEqual(event["chunk"], 2)
        self.assertEqual(event["total"], 5)
        self.assertTrue(closed.is_set())

    def test_chunker_does_not_split_marker_tokens(self) -> None:
        masked = "paragraph " * 120 + "QZPROTECTED000001XZQ" + " text " * 140
        chunks = split_chunks(masked, 1000)
        combined = "".join(chunks)
        self.assertEqual(combined, masked)
        self.assertEqual(
            [marker for chunk in chunks for marker in MARKER_RE.findall(chunk)],
            MARKER_RE.findall(masked),
        )


if __name__ == "__main__":
    unittest.main()
