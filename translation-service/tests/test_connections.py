"""共有接続先の資格情報・切替・DB 更新で守るべき境界を検証します。"""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import HTTPException

from app import main
from app.database import TranslationDatabase

PROJECT_ID = "f" * 24


class ConnectionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.database = TranslationDatabase(str(Path(self.directory.name) / "connections.sqlite3"))
        self.patches = [patch.object(main, "database", self.database), patch.object(main, "BASE_URL", "http://env.example/v1"), patch.object(main, "API_KEY", "env-only-secret")]
        for item in self.patches:
            item.start()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://translation.test")

    async def asyncTearDown(self):
        await self.client.aclose()
        for item in reversed(self.patches):
            item.stop()
        self.directory.cleanup()

    async def create(self, **changes):
        response = await self.client.post("/endpoints", json={"name": "test", "base_url": "http://a.example/v1", **changes})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    async def test_saved_keys_are_not_returned_or_inherited_from_environment(self):
        endpoint = await self.create(api_key="saved-only-secret")
        self.assertTrue(endpoint["has_api_key"])
        response = await self.client.get("/endpoints")
        self.assertNotIn("saved-only-secret", response.text)
        self.assertNotIn("env-only-secret", response.text)
        no_key = await self.create(base_url="http://without-key.example/v1")
        self.assertFalse(no_key["has_api_key"])
        self.assertNotIn("Authorization", main._effective_llm_settings(no_key["id"])[1])
        self.assertEqual(main._effective_llm_settings()[1]["Authorization"], "Bearer env-only-secret")

    async def test_edit_retains_key_only_for_same_url_and_allows_explicit_clear(self):
        endpoint = await self.create(api_key="saved-only-secret")
        path = "/endpoints/" + endpoint["id"]
        base = {"name": "edited", "base_url": "http://a.example/v1"}
        self.assertTrue((await self.client.put(path, json=base)).json()["has_api_key"])
        changed = await self.client.put(path, json={**base, "base_url": "http://b.example/v1"})
        self.assertFalse(changed.json()["has_api_key"])
        await self.client.put(path, json={**base, "api_key": "replacement-secret"})
        cleared = await self.client.put(path, json={**base, "clear_api_key": True})
        self.assertFalse(cleared.json()["has_api_key"])
        self.assertEqual(self.database.get_endpoint_credentials(endpoint["id"])[1], "")

    async def test_connection_test_does_not_send_another_urls_credentials(self):
        endpoint = await self.create(api_key="saved-only-secret")
        observed = []

        def provider(request):
            observed.append(request.headers.get("Authorization"))
            return httpx.Response(200, json={"data": [{"id": "model"}]})

        client_class = httpx.AsyncClient
        with patch.object(main.httpx, "AsyncClient", side_effect=lambda **options: client_class(transport=httpx.MockTransport(provider), **options)):
            for candidate in (
                {"base_url": "http://other.example/v1", "endpoint_id": endpoint["id"]},
                {"base_url": "http://a.example/v1", "endpoint_id": endpoint["id"]},
                {"base_url": "http://a.example/v1", "endpoint_id": endpoint["id"], "clear_api_key": True},
                {"base_url": "http://env.example/v1"},
            ):
                response = await self.client.post("/endpoints/test", json=candidate)
                self.assertTrue(response.json()["ok"])
        self.assertEqual(observed, [None, "Bearer saved-only-secret", None, None])

    async def test_url_and_parameter_validation(self):
        for url in ("ftp://host/v1", "http://user:password@host/v1", "http://host/v1?api_key=secret", "http://host:99999/v1", "http:///v1"):
            response = await self.client.post("/endpoints", json={"name": "bad", "base_url": url})
            self.assertEqual(response.status_code, 400, url)
        for changes in ({"name": "   "}, {"extra_params": {"messages": []}}, {"extra_params": {"stream": False}}):
            response = await self.client.post("/endpoints", json={"name": "test", "base_url": "http://a.example/v1", **changes})
            self.assertEqual(response.status_code, 400)
        with self.assertRaises(HTTPException):
            await main.create_endpoint(main.EndpointPayload(name="bad", base_url="http://a.example/v1", extra_params={"temperature": float("nan")}))

    async def test_malformed_provider_response_is_not_a_successful_test(self):
        client_class = httpx.AsyncClient
        def provider(_request):
            return httpx.Response(200, json={"unexpected": "payload"})
        with patch.object(main.httpx, "AsyncClient", side_effect=lambda **options: client_class(transport=httpx.MockTransport(provider), **options)):
            response = await self.client.post("/endpoints/test", json={"base_url": "http://a.example/v1"})
        self.assertFalse(response.json()["ok"])

    async def test_model_list_only_returns_display_fields(self):
        client_class = httpx.AsyncClient
        def provider(_request):
            return httpx.Response(200, json={"data": [{"id": "safe", "owned_by": "lab", "api_key": "provider-secret", "internal_config": {"token": "hidden"}}]})
        with patch.object(main.httpx, "AsyncClient", side_effect=lambda **options: client_class(transport=httpx.MockTransport(provider), **options)):
            response = await self.client.get("/models")
        self.assertEqual(response.json(), {"data": [{"id": "safe", "owned_by": "lab"}]})

    async def test_missing_selection_does_not_fall_back_to_another_destination(self):
        self.database.put_settings(PROJECT_ID, {"model": "m", "endpoint_id": "0" * 16})
        requests = []
        client_class = httpx.AsyncClient
        def provider(request):
            requests.append(request)
            return httpx.Response(200, json={"data": [{"id": "m"}]})
        with patch.object(main.httpx, "AsyncClient", side_effect=lambda **options: client_class(transport=httpx.MockTransport(provider), **options)):
            response = await self.client.post(f"/projects/{PROJECT_ID}/translate", json={"text": "日本語"})
        self.assertIn('"type":"error"', response.text)
        self.assertNotIn('"type":"complete"', response.text)
        self.assertEqual(requests, [])

    async def test_one_translation_keeps_its_connection_when_configuration_changes(self):
        endpoint = await self.create(api_key="original-secret", set_default=True)
        observed = []

        def provider(request):
            observed.append((request.url.host, request.headers.get("Authorization")))
            if request.url.path.endswith("/models"):
                # モデル一覧取得直後に管理者が接続先を更新しても、実行中の送信先は固定です。
                self.database.update_endpoint(endpoint["id"], "changed", "http://b.example/v1", "changed-secret", {})
                return httpx.Response(200, json={"data": [{"id": "m"}]})
            payload = json.loads(request.content)
            fragment = payload["messages"][-1]["content"].split("<fragment>\n", 1)[1].rsplit("\n</fragment>", 1)[0]
            event = {"choices": [{"delta": {"content": fragment.replace("日本語", "English")}}]}
            return httpx.Response(200, text="data: " + json.dumps(event) + "\n\ndata: [DONE]\n\n", headers={"Content-Type": "text/event-stream"})

        client_class = httpx.AsyncClient
        with patch.object(main.httpx, "AsyncClient", side_effect=lambda **options: client_class(transport=httpx.MockTransport(provider), **options)):
            response = await self.client.post(f"/projects/{PROJECT_ID}/translate", json={"text": "日本語", "model": "m"})
        self.assertIn('"text":"English"', response.text)
        self.assertEqual(observed, [("a.example", "Bearer original-secret"), ("a.example", "Bearer original-secret")])

    async def test_missing_default_target_does_not_clear_existing_default(self):
        endpoint = await self.create(set_default=True)
        self.assertFalse(self.database.set_default_endpoint("missing"))
        self.assertTrue(self.database.get_endpoint(endpoint["id"])["is_default"])
        reopened = TranslationDatabase(str(self.database.path))
        self.assertEqual(reopened.get_default_endpoint_credentials()[0], "http://a.example/v1")


class DatabaseMigrationTests(unittest.TestCase):
    def test_old_endpoint_schema_is_extended_without_losing_saved_data(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "old.sqlite3"
            connection = sqlite3.connect(path)
            try:
                connection.execute("CREATE TABLE llm_endpoints (id TEXT PRIMARY KEY, name TEXT, base_url TEXT, api_key TEXT, extra_params TEXT, is_default INTEGER, created_at TEXT, updated_at TEXT)")
                connection.execute("INSERT INTO llm_endpoints VALUES ('old', 'old', 'http://old.example/v1', 'old-secret', '{}', 1, '', '')")
                connection.commit()
            finally:
                connection.close()
            database = TranslationDatabase(str(path))
            endpoint = database.get_endpoint("old")
            self.assertFalse(endpoint["minimal_prompt"])
            self.assertIsNone(endpoint["chunk_chars"])
            self.assertEqual(database.get_default_endpoint_credentials()[1], "old-secret")
            with self.assertRaises(sqlite3.IntegrityError):
                database.add_endpoint("second", "second", "http://second.example/v1", "", {}, make_default=False)
                with database._connect() as connection:
                    connection.execute("UPDATE llm_endpoints SET is_default=1 WHERE id='second'")


if __name__ == "__main__":
    unittest.main()
