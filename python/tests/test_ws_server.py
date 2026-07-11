"""
Integration tests for LiveflowServer — WebSocket upgrade, message relay,
replay, Origin validation, and static HTTP serving on the same port.
"""

import asyncio
import json
import os
import time

import pytest
import websockets
from websockets.asyncio.client import connect

from liveflow.ws_server import LiveflowServer
from liveflow.protocol import PongMessage, BaseMessage


# Helper to await an async generator's first item (or timeout)
async def _recv_one(ws, timeout=2.0):
    try:
        return await asyncio.wait_for(ws.recv(), timeout=timeout)
    except asyncio.TimeoutError:
        return None


# ---------------------------------------------------------------------------
# WebSocket lifecycle
# ---------------------------------------------------------------------------

class TestWebSocketBasic:
    @pytest.mark.asyncio
    async def test_client_connect_and_pong(self, unused_tcp_port):
        """A client connecting to the server gets a pong response for a ping."""
        server = LiveflowServer(port=unused_tcp_port)
        server.start()
        try:
            url = f"ws://127.0.0.1:{server.port}/ws"
            async with connect(url) as ws:
                ping = json.dumps({"type": "ping", "session_id": ""})
                await ws.send(ping)
                resp = await _recv_one(ws)
                data = json.loads(resp)
                assert data["type"] == "pong"
        finally:
            server.stop()

    @pytest.mark.asyncio
    async def test_client_receives_replayed_messages(self, unused_tcp_port):
        """Stored messages are replayed to new clients."""
        server = LiveflowServer(port=unused_tcp_port)

        # Store a code_scan message before starting
        from liveflow.protocol import CodeScanMessage
        scan = CodeScanMessage(agents=[], handoffs=[])
        server.set_initial_scan(scan)

        server.start()
        try:
            url = f"ws://127.0.0.1:{server.port}/ws"
            async with connect(url) as ws:
                # First message should be the replayed code_scan
                resp = await _recv_one(ws)
                data = json.loads(resp)
                assert data["type"] == "code_scan"
        finally:
            server.stop()

    @pytest.mark.asyncio
    async def test_message_broadcast_to_clients(self, unused_tcp_port):
        """Messages sent via broadcast() reach connected clients."""
        server = LiveflowServer(port=unused_tcp_port)
        server.start()
        try:
            url = f"ws://127.0.0.1:{server.port}/ws"
            async with connect(url) as ws:
                # Send a message via broadcast
                msg = BaseMessage(type="test", session_id="abc", timestamp="")
                server.broadcast(msg)

                resp = await _recv_one(ws)
                data = json.loads(resp)
                assert data["type"] == "test"
        finally:
            server.stop()

    @pytest.mark.asyncio
    async def test_client_message_relay(self, unused_tcp_port):
        """Messages from one WS client are relayed to others."""
        server = LiveflowServer(port=unused_tcp_port)
        server.start()
        try:
            url = f"ws://127.0.0.1:{server.port}/ws"
            async with connect(url) as client1, connect(url) as client2:
                # client1 sends a non-ping message
                msg = json.dumps({"type": "agent_state", "new_state": "thinking"})
                await client1.send(msg)

                # client2 should receive it (relayed)
                resp = await _recv_one(client2)
                data = json.loads(resp)
                assert data["type"] == "agent_state"
                assert data["new_state"] == "thinking"

                # client1 should NOT get echo of its own message
                echo = await _recv_one(client1, timeout=0.3)
                assert echo is None
        finally:
            server.stop()


# ---------------------------------------------------------------------------
# Static HTTP serving on same port
# ---------------------------------------------------------------------------

class TestStaticHttpServing:
    @pytest.mark.asyncio
    async def test_healthz_endpoint(self, unused_tcp_port):
        """GET /healthz returns 200 JSON."""
        server = LiveflowServer(port=unused_tcp_port)
        server.start()
        try:
            import http.client
            conn = http.client.HTTPConnection("127.0.0.1", server.port, timeout=2)
            conn.request("GET", "/healthz")
            resp = conn.getresponse()
            assert resp.status == 200
            body = resp.read().decode()
            assert '"ok"' in body
            conn.close()
        finally:
            server.stop()

    @pytest.mark.asyncio
    async def test_static_html_served(self, unused_tcp_port, tmp_path):
        """Static HTML files are served from the SPA dir."""
        spa = tmp_path / "spa"
        spa.mkdir()
        (spa / "index.html").write_text("<html>Test</html>")
        (spa / "app.js").write_text("console.log(1)")

        server = LiveflowServer(port=unused_tcp_port, spa_dir=str(spa))
        server.start()
        try:
            import http.client
            # Serve index.html
            conn = http.client.HTTPConnection("127.0.0.1", server.port, timeout=2)
            conn.request("GET", "/")
            resp = conn.getresponse()
            assert resp.status == 200
            assert b"Test" in resp.read()
            conn.close()

            # Serve app.js
            conn = http.client.HTTPConnection("127.0.0.1", server.port, timeout=2)
            conn.request("GET", "/app.js")
            resp = conn.getresponse()
            assert resp.status == 200
            body = resp.read()
            assert b"console.log" in body
            conn.close()
        finally:
            server.stop()

    @pytest.mark.asyncio
    async def test_spa_fallback(self, unused_tcp_port, tmp_path):
        """Unknown paths fall back to index.html."""
        spa = tmp_path / "spa"
        spa.mkdir()
        (spa / "index.html").write_text("<html>SPA</html>")

        server = LiveflowServer(port=unused_tcp_port, spa_dir=str(spa))
        server.start()
        try:
            import http.client
            conn = http.client.HTTPConnection("127.0.0.1", server.port, timeout=2)
            conn.request("GET", "/deep/nested/route")
            resp = conn.getresponse()
            assert resp.status == 200
            assert b"SPA" in resp.read()
            conn.close()
        finally:
            server.stop()

    @pytest.mark.asyncio
    async def test_traversal_rejected(self, unused_tcp_port, tmp_path):
        """Path traversal attempts return 403."""
        spa = tmp_path / "spa"
        spa.mkdir()
        (spa / "index.html").write_text("<html>")

        server = LiveflowServer(port=unused_tcp_port, spa_dir=str(spa))
        server.start()
        try:
            import http.client
            conn = http.client.HTTPConnection("127.0.0.1", server.port, timeout=2)
            conn.request("GET", "/../../../etc/passwd")
            resp = conn.getresponse()
            assert resp.status == 403
            conn.close()
        finally:
            server.stop()

    @pytest.mark.asyncio
    async def test_missing_file_spa_fallback(self, unused_tcp_port, tmp_path):
        """Missing files fall back to index.html (SPA behavior)."""
        spa = tmp_path / "spa"
        spa.mkdir()
        (spa / "index.html").write_text("<html>SPA</html>")

        server = LiveflowServer(port=unused_tcp_port, spa_dir=str(spa))
        server.start()
        try:
            import http.client
            conn = http.client.HTTPConnection("127.0.0.1", server.port, timeout=2)
            conn.request("GET", "/nonexistent.js")
            resp = conn.getresponse()
            assert resp.status == 200
            assert b"SPA" in resp.read()
            conn.close()
        finally:
            server.stop()

    @pytest.mark.asyncio
    async def test_missing_file_no_index_returns_404(self, unused_tcp_port, tmp_path):
        """Missing files return 404 when no index.html exists."""
        spa = tmp_path / "spa"
        spa.mkdir()
        # No index.html — just an empty dir

        server = LiveflowServer(port=unused_tcp_port, spa_dir=str(spa))
        server.start()
        try:
            import http.client
            conn = http.client.HTTPConnection("127.0.0.1", server.port, timeout=2)
            conn.request("GET", "/nonexistent.js")
            resp = conn.getresponse()
            assert resp.status == 404
            conn.close()
        finally:
            server.stop()

    @pytest.mark.asyncio
    async def test_http_and_ws_on_same_port(self, unused_tcp_port, tmp_path):
        """HTTP and WebSocket work concurrently on the same port."""
        spa = tmp_path / "spa"
        spa.mkdir()
        (spa / "index.html").write_text("<html>Hi</html>")

        server = LiveflowServer(port=unused_tcp_port, spa_dir=str(spa))
        server.start()
        try:
            # HTTP request
            import http.client
            conn = http.client.HTTPConnection("127.0.0.1", server.port, timeout=2)
            conn.request("GET", "/")
            resp = conn.getresponse()
            assert resp.status == 200
            assert b"Hi" in resp.read()
            conn.close()

            # WebSocket connection
            url = f"ws://127.0.0.1:{server.port}/ws"
            async with connect(url) as ws:
                ping = json.dumps({"type": "ping"})
                await ws.send(ping)
                resp = await _recv_one(ws)
                data = json.loads(resp)
                assert data["type"] == "pong"
        finally:
            server.stop()


# ---------------------------------------------------------------------------
# Origin validation at the server level
# ---------------------------------------------------------------------------

class TestOriginValidation:
    @pytest.mark.asyncio
    async def test_ws_without_origin_connects(self, unused_tcp_port):
        """Internal clients without Origin header connect fine."""
        server = LiveflowServer(port=unused_tcp_port)
        server.start()
        try:
            # connect without origin header
            url = f"ws://127.0.0.1:{server.port}/ws"
            async with connect(url, additional_headers={}) as ws:
                ping = json.dumps({"type": "ping"})
                await ws.send(ping)
                resp = await _recv_one(ws)
                assert json.loads(resp)["type"] == "pong"
        finally:
            server.stop()

    @pytest.mark.asyncio
    async def test_ws_with_loopback_origin_connects(self, unused_tcp_port):
        """Browser with loopback Origin connects fine."""
        server = LiveflowServer(port=unused_tcp_port)
        server.start()
        try:
            url = f"ws://127.0.0.1:{server.port}/ws"
            async with connect(url, additional_headers={"Origin": "http://localhost:8765"}) as ws:
                ping = json.dumps({"type": "ping"})
                await ws.send(ping)
                resp = await _recv_one(ws)
                assert json.loads(resp)["type"] == "pong"
        finally:
            server.stop()

    @pytest.mark.asyncio
    async def test_ws_with_hostile_origin_rejected(self, unused_tcp_port):
        """Browser with non-loopback Origin is rejected."""
        server = LiveflowServer(port=unused_tcp_port)
        server.start()
        try:
            url = f"ws://127.0.0.1:{server.port}/ws"
            with pytest.raises(Exception):
                async with connect(url, additional_headers={"Origin": "http://evil.com"}) as ws:
                    pass
        finally:
            server.stop()


# ---------------------------------------------------------------------------
# Port determinism
# ---------------------------------------------------------------------------

class TestPortBinding:
    def test_default_random_port(self):
        """Port=0 gives a random available port."""
        server = LiveflowServer()
        server.start()
        try:
            assert server.port is not None
            assert server.port > 0
        finally:
            server.stop()

    def test_explicit_port(self, unused_tcp_port):
        """Specified port is used."""
        server = LiveflowServer(port=unused_tcp_port)
        server.start()
        try:
            assert server.port == unused_tcp_port
        finally:
            server.stop()

    def test_no_port_file_created(self, unused_tcp_port):
        """Start/stop does not create /tmp/liveflow-*.port files."""
        import glob as glob_mod
        import os as os_mod
        pid = os_mod.getpid()
        before = set(glob_mod.glob(f"/tmp/liveflow-{pid}.port"))

        server = LiveflowServer(port=unused_tcp_port)
        server.start()
        server.stop()

        after = set(glob_mod.glob(f"/tmp/liveflow-{pid}.port"))
        new_files = after - before
        assert new_files == set(), f"Unexpected port files: {new_files}"

    def test_no_port_file_attribute(self):
        """LiveflowServer no longer exposes a port_file property."""
        server = LiveflowServer()
        with pytest.raises(AttributeError):
            _ = server.port_file


# ---------------------------------------------------------------------------
# pytest fixture for unused ports
# ---------------------------------------------------------------------------

@pytest.fixture
def unused_tcp_port():
    """Return an available TCP port number."""
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
