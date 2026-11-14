"""実際の uvicorn と模擬 OpenAI 互換サーバーを HTTP で接続するテストです。

外部 LLM や稼働中の Overleaf には接続せず、一時 DB とループバックだけを使います。
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx

PROJECT_ID = "d" * 24
MODELS = ("mock-stream", "mock-json", "mock-truncated")


class MockLLMHandler(BaseHTTPRequestHandler):
    """認証と messages を受け取り、制御できるストリーム・通常応答を返します。"""

    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass

    def reply(self, content_type, body):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/v1/models" or self.headers.get("Authorization") != "Bearer test-only-key":
            self.send_error(403)
            return
        self.reply("application/json", json.dumps({"data": [{"id": model} for model in MODELS]}).encode())

    def do_POST(self):
        if self.path != "/v1/chat/completions" or self.headers.get("Authorization") != "Bearer test-only-key":
            self.send_error(403)
            return
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        fragment = payload["messages"][-1]["content"].split("<fragment>\n", 1)[1].rsplit("\n</fragment>", 1)[0]
        translated = fragment.replace("日本語", "English")
        if payload["model"] == "mock-json":
            result = {"choices": [{"message": {"content": translated}, "finish_reason": "stop"}]}
            self.reply("application/json", json.dumps(result).encode())
            return
        reason = "length" if payload["model"] == "mock-truncated" else "stop"
        events = [
            {"choices": [{"delta": {"content": translated}}]},
            {"choices": [{"delta": {}, "finish_reason": reason}]},
        ]
        body = "".join("data: " + json.dumps(event) + "\n\n" for event in events) + "data: [DONE]\n\n"
        self.reply("text/event-stream", body.encode())


class ContainerHTTPSmokeTests(unittest.TestCase):
    def test_http_translation_fallback_and_persistence_after_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            mock = ThreadingHTTPServer(("127.0.0.1", 0), MockLLMHandler)
            thread = threading.Thread(target=mock.serve_forever, daemon=True)
            thread.start()
            # Docker 内の空きポートを使い、ホストのポートや既存サービスに触れません。
            with socket.socket() as reservation:
                reservation.bind(("127.0.0.1", 0))
                port = reservation.getsockname()[1]
            environment = {
                **os.environ,
                "TRANSLATION_DB_PATH": str(Path(directory) / "translation.sqlite3"),
                "LOCAL_LLM_BASE_URL": f"http://127.0.0.1:{mock.server_port}/v1",
                "LOCAL_LLM_API_KEY": "test-only-key",
            }
            process = None
            with open(Path(directory) / "uvicorn.log", "w+") as log, httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=20, trust_env=False) as client:
                def start():
                    nonlocal process
                    process = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)], env=environment, stdout=log, stderr=log)
                    deadline = time.monotonic() + 15
                    while time.monotonic() < deadline:
                        if process.poll() is not None:
                            break
                        try:
                            if client.get("/health").status_code == 200:
                                return
                        except httpx.TransportError:
                            pass
                        time.sleep(0.05)
                    log.seek(0)
                    self.fail("uvicorn startup failed: " + log.read())

                def translate(model, source):
                    response = client.post(f"/projects/{PROJECT_ID}/translate", json={"text": source, "model": model})
                    self.assertEqual(response.status_code, 200)
                    self.assertIn("text/event-stream", response.headers["content-type"])
                    events = [json.loads(frame[6:]) for frame in response.text.split("\n\n") if frame.startswith("data: ")]
                    self.assertFalse(any(event["type"] == "error" for event in events), events)
                    return next(event for event in events if event["type"] == "complete")

                try:
                    start()
                    self.assertEqual([item["id"] for item in client.get("/models").json()["data"]], list(MODELS))
                    settings = {"model": "mock-stream", "terms": [{"source": "日本語", "target": "English"}]}
                    self.assertEqual(client.put(f"/projects/{PROJECT_ID}/settings", json=settings).status_code, 200)
                    source = "\\textbf{日本語} $x=1$\n% コメント\n\n日本語\\cite{example}"
                    for model in ("mock-stream", "mock-json"):
                        result = translate(model, source)
                        self.assertEqual(result["text"], source.replace("日本語", "English"))
                        self.assertEqual(result["failed_chunks"], [])
                    # 保護マーカーが揃っていても、出力上限で切れた応答は原文へ戻します。
                    result = translate("mock-truncated", "日本語")
                    self.assertEqual(result["text"], "日本語")
                    self.assertEqual(result["failed_chunks"], [1])
                    process.terminate()
                    process.wait(timeout=10)
                    start()
                    saved = client.get(f"/projects/{PROJECT_ID}/settings").json()
                    self.assertEqual(saved["model"], "mock-stream")
                    self.assertEqual(saved["terms"], settings["terms"])
                finally:
                    if process is not None and process.poll() is None:
                        process.terminate()
                        process.wait(timeout=10)
                    mock.shutdown()
                    mock.server_close()
                    thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
