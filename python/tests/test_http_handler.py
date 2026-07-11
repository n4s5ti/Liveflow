"""
Tests for liveflow.http_handler — static file serving, MIME types,
path traversal rejection, SPA fallback, /healthz endpoint,
and loopback Origin validation.
"""

import os
import tempfile
from pathlib import Path

import pytest

from liveflow.http_handler import (
    _get_mime_type,
    _is_safe_path,
    _resolve_static_path,
    _validate_origin,
    find_spa_dir,
    create_process_request,
)


# ---------------------------------------------------------------------------
# MIME type detection
# ---------------------------------------------------------------------------

class TestMimeTypes:
    def test_html(self):
        assert _get_mime_type("index.html") == "text/html; charset=utf-8"

    def test_css(self):
        assert _get_mime_type("styles.css") == "text/css; charset=utf-8"

    def test_js(self):
        assert _get_mime_type("bundle.js") == "application/javascript; charset=utf-8"
        assert _get_mime_type("main.mjs") == "application/javascript; charset=utf-8"

    def test_json(self):
        assert _get_mime_type("data.json") == "application/json"

    def test_svg(self):
        assert _get_mime_type("icon.svg") == "image/svg+xml"

    def test_png(self):
        assert _get_mime_type("logo.png") == "image/png"

    def test_ico(self):
        assert _get_mime_type("favicon.ico") == "image/x-icon"

    def test_woff2(self):
        assert _get_mime_type("font.woff2") == "font/woff2"

    def test_unknown(self):
        assert _get_mime_type("something.bin") == "application/octet-stream"

    def test_no_extension(self):
        assert _get_mime_type("README") == "application/octet-stream"


# ---------------------------------------------------------------------------
# Safe path validation
# ---------------------------------------------------------------------------

class TestIsSafePath:
    def test_simple_file(self, tmp_path):
        root = str(tmp_path)
        f = tmp_path / "index.html"
        f.write_text("hello")
        resolved = _is_safe_path(root, "index.html")
        assert resolved == str(f)

    def test_nested_file(self, tmp_path):
        root = str(tmp_path)
        sub = tmp_path / "assets"
        sub.mkdir()
        f = sub / "style.css"
        f.write_text("body{}")
        resolved = _is_safe_path(root, "assets/style.css")
        assert resolved == str(f)

    def test_directory_is_rejected(self, tmp_path):
        root = str(tmp_path)
        sub = tmp_path / "assets"
        sub.mkdir()
        status, path = _resolve_static_path(root, "/assets")
        assert status == "not_found"
        assert path is None

    def test_traversal_dots(self, tmp_path):
        root = str(tmp_path)
        resolved = _is_safe_path(root, "../../etc/passwd")
        assert resolved is None

    def test_absolute_path_is_safe(self, tmp_path):
        """Absolute paths are stripped to relative — not a traversal."""
        root = str(tmp_path)
        resolved = _is_safe_path(root, "/etc/passwd")
        # /etc/passwd becomes etc/passwd relative to root — safe
        assert resolved is not None
        assert root in resolved

    def test_traversal_encoded(self, tmp_path):
        root = str(tmp_path)
        resolved = _is_safe_path(root, "..%2F..%2Fetc%2Fpasswd")
        assert resolved is None

    def test_null_byte(self, tmp_path):
        root = str(tmp_path)
        resolved = _is_safe_path(root, "index.html\x00.txt")
        assert resolved is None

    def test_dotfile_served(self, tmp_path):
        """Dotfiles that exist inside the root are served (e.g. .well-known)."""
        root = str(tmp_path)
        f = tmp_path / ".well-known"
        f.mkdir()
        config = f / "config.json"
        config.write_text("{}")
        resolved = _is_safe_path(root, ".well-known/config.json")
        assert resolved == str(config)


# ---------------------------------------------------------------------------
# Static path resolution (SPA fallback)
# ---------------------------------------------------------------------------

class TestResolveStaticPath:
    def test_exact_file(self, tmp_path):
        root = str(tmp_path)
        f = tmp_path / "index.html"
        f.write_text("<html>")
        status, path = _resolve_static_path(root, "/index.html")
        assert status == "file"
        assert path == str(f)

    def test_root_fallback_to_index(self, tmp_path):
        root = str(tmp_path)
        f = tmp_path / "index.html"
        f.write_text("<html>")
        status, path = _resolve_static_path(root, "/")
        assert status == "file"
        assert path == str(f)

    def test_spa_fallback(self, tmp_path):
        root = str(tmp_path)
        f = tmp_path / "index.html"
        f.write_text("<html>")
        status, path = _resolve_static_path(root, "/dashboard/users")
        assert status == "file"
        assert path == str(f)

    def test_existing_asset_no_fallback(self, tmp_path):
        root = str(tmp_path)
        sub = tmp_path / "assets"
        sub.mkdir()
        asset = sub / "logo.png"
        asset.write_text("PNG")
        f = tmp_path / "index.html"
        f.write_text("<html>")
        status, path = _resolve_static_path(root, "/assets/logo.png")
        assert status == "file"
        assert path == str(asset)

    def test_healthz(self):
        status, path = _resolve_static_path("/nonexistent", "/healthz")
        assert status == "healthz"
        status, path = _resolve_static_path("/nonexistent", "/healthz?x=1")
        assert status == "healthz"

    def test_strips_query_string(self, tmp_path):
        root = str(tmp_path)
        f = tmp_path / "index.html"
        f.write_text("<html>")
        status, path = _resolve_static_path(root, "/?v=2")
        assert status == "file"
        assert path == str(f)

    def test_traversal_returns_traversal(self, tmp_path):
        root = str(tmp_path)
        status, path = _resolve_static_path(root, "/../../../etc/passwd")
        assert status == "traversal"
        assert path is None

    def test_not_found_no_index(self, tmp_path):
        root = str(tmp_path)
        status, path = _resolve_static_path(root, "/nonexistent.js")
        assert status == "not_found"
        assert path is None

    def test_directory_rejected(self, tmp_path):
        root = str(tmp_path)
        sub = tmp_path / "assets"
        sub.mkdir()
        status, path = _resolve_static_path(root, "/assets")
        assert status == "not_found"


# ---------------------------------------------------------------------------
# Origin validation
# ---------------------------------------------------------------------------

class TestValidateOrigin:
    def test_localhost_http(self):
        assert _validate_origin("http://localhost:8765") is True

    def test_localhost_https(self):
        assert _validate_origin("https://localhost:8765") is True

    def test_loopback_ipv4(self):
        assert _validate_origin("http://127.0.0.1:8765") is True
        assert _validate_origin("http://127.0.0.1:3000") is True

    def test_loopback_ipv6(self):
        assert _validate_origin("http://[::1]:8765") is True

    def test_missing_origin(self):
        """Non-browser/internal clients may omit Origin."""
        assert _validate_origin(None) is True

    def test_empty_origin(self):
        """Empty Origin is allowed (non-browser clients)."""
        assert _validate_origin("") is True

    def test_external_origin_rejected(self):
        assert _validate_origin("http://192.168.1.1:8765") is False

    def test_remote_origin_rejected(self):
        assert _validate_origin("http://example.com") is False

    def test_file_origin_rejected(self):
        assert _validate_origin("file://") is False

    def test_null_origin_string(self):
        """The string 'null' is sent by some sandboxed contexts."""
        assert _validate_origin("null") is False

    def test_uppercase_localhost(self):
        """Origin hostnames are case-insensitive per RFC 3986."""
        assert _validate_origin("http://LOCALHOST:8765") is True

    def test_uppercase_loopback_ipv4(self):
        assert _validate_origin("HTTP://127.0.0.1:3000") is True

    def test_uppercase_external_rejected(self):
        assert _validate_origin("http://EVIL.COM") is False


# ---------------------------------------------------------------------------
# SPA directory discovery
# ---------------------------------------------------------------------------

class TestFindSpaDir:
    def test_source_packages_exists(self):
        """If packages/webview/dist exists, it is preferred."""
        # This test is environment-dependent; skip if not in source tree
        pass  # Integration test below

    def test_frozen_directory(self, tmp_path, monkeypatch):
        """find_spa_dir should detect liveflow/_web near __file__."""
        import liveflow.http_handler as mod
        web_dir = tmp_path / "liveflow" / "_web"
        web_dir.mkdir(parents=True)
        (web_dir / "index.html").write_text("<html>")
        # Block all other discovery paths
        monkeypatch.setattr(mod, "__file__", str(tmp_path / "liveflow" / "http_handler.py"))
        monkeypatch.setattr(os, "getcwd", lambda: str(tmp_path))  # Block parent-walk
        monkeypatch.delenv("LIVEFLOW_SPA_DIR", raising=False)
        result = find_spa_dir()
        assert result == str(web_dir)

    def test_frozen_no_web_dir_returns_none(self, tmp_path, monkeypatch):
        import liveflow.http_handler as mod
        monkeypatch.setattr(mod, "__file__", str(tmp_path / "liveflow" / "http_handler.py"))
        monkeypatch.setattr(os, "getcwd", lambda: str(tmp_path))  # Block parent-walk
        monkeypatch.delenv("LIVEFLOW_SPA_DIR", raising=False)
        result = find_spa_dir()
        assert result is None

    def test_parent_walk_finds_dist(self, tmp_path, monkeypatch):
        """Walking up from a subdirectory finds packages/webview/dist."""
        import liveflow.http_handler as mod
        # Create repo structure
        dist = tmp_path / "packages" / "webview" / "dist"
        dist.mkdir(parents=True)
        (dist / "index.html").write_text("<html>")
        # cd into a deep subdirectory
        subdir = tmp_path / "apps" / "landing" / "src"
        subdir.mkdir(parents=True)
        monkeypatch.setattr(os, "getcwd", lambda: str(subdir))
        monkeypatch.setattr(mod, "__file__", str(tmp_path / "nonexistent" / "http_handler.py"))
        monkeypatch.delenv("LIVEFLOW_SPA_DIR", raising=False)
        result = find_spa_dir()
        assert result == str(dist)

    def test_parent_walk_stops_at_root(self, tmp_path, monkeypatch):
        """Walking up to filesystem root without finding dist returns None."""
        import liveflow.http_handler as mod
        monkeypatch.setattr(os, "getcwd", lambda: str(tmp_path))
        monkeypatch.setattr(mod, "__file__", str(tmp_path / "nonexistent" / "http_handler.py"))
        monkeypatch.delenv("LIVEFLOW_SPA_DIR", raising=False)
        result = find_spa_dir()
        assert result is None



# ---------------------------------------------------------------------------
# process_request callback (HTTP/WS routing)
# ---------------------------------------------------------------------------

class TestProcessRequest:
    @pytest.mark.asyncio
    async def test_healthz_returns_200(self, tmp_path):
        root = str(tmp_path)
        (tmp_path / "index.html").write_text("spa")
        handler = create_process_request(spa_dir=root)

        from websockets.http11 import Request
        from websockets.datastructures import Headers
        req = Request(path="/healthz", headers=Headers())
        resp = await handler(None, req)
        assert resp is not None
        assert resp.status_code == 200
        assert b"ok" in resp.body

    @pytest.mark.asyncio
    async def test_static_html_returns_file(self, tmp_path):
        root = str(tmp_path)
        (tmp_path / "index.html").write_text("<html><body>Hi</body></html>")
        handler = create_process_request(spa_dir=root)

        from websockets.http11 import Request
        from websockets.datastructures import Headers
        req = Request(path="/index.html", headers=Headers())
        resp = await handler(None, req)
        assert resp is not None
        assert resp.status_code == 200
        assert b"<html>" in resp.body

    @pytest.mark.asyncio
    async def test_static_returns_correct_mime(self, tmp_path):
        root = str(tmp_path)
        (tmp_path / "styles.css").write_text("body{color:red}")
        handler = create_process_request(spa_dir=root)

        from websockets.http11 import Request
        from websockets.datastructures import Headers
        req = Request(path="/styles.css", headers=Headers())
        resp = await handler(None, req)
        assert resp is not None
        assert resp.status_code == 200
        assert resp.headers["Content-Type"] == "text/css; charset=utf-8"

    @pytest.mark.asyncio
    async def test_spa_fallback_returns_index(self, tmp_path):
        root = str(tmp_path)
        (tmp_path / "index.html").write_text("<html>SPA</html>")
        handler = create_process_request(spa_dir=root)

        from websockets.http11 import Request
        from websockets.datastructures import Headers
        req = Request(path="/deep/nested/route", headers=Headers())
        resp = await handler(None, req)
        assert resp is not None
        assert resp.status_code == 200
        assert b"SPA" in resp.body

    @pytest.mark.asyncio
    async def test_traversal_returns_403(self, tmp_path):
        root = str(tmp_path)
        handler = create_process_request(spa_dir=root)

        from websockets.http11 import Request
        from websockets.datastructures import Headers
        req = Request(path="/../../../etc/passwd", headers=Headers())
        resp = await handler(None, req)
        assert resp is not None
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_missing_file_returns_404(self, tmp_path):
        root = str(tmp_path)
        handler = create_process_request(spa_dir=root)

        from websockets.http11 import Request
        from websockets.datastructures import Headers
        req = Request(path="/nonexistent.js", headers=Headers())
        resp = await handler(None, req)
        assert resp is not None
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_ws_path_returns_none(self, tmp_path):
        """WebSocket upgrade: /ws path returns None so websockets handles it."""
        root = str(tmp_path)
        handler = create_process_request(spa_dir=root)

        from websockets.http11 import Request
        from websockets.datastructures import Headers
        req = Request(path="/ws", headers=Headers())
        resp = await handler(None, req)
        assert resp is None  # None = proceed with WS upgrade

    @pytest.mark.asyncio
    async def test_ws_path_with_loopback_origin(self, tmp_path):
        """WebSocket /ws with valid loopback Origin proceeds."""
        root = str(tmp_path)
        handler = create_process_request(spa_dir=root)

        from websockets.http11 import Request
        from websockets.datastructures import Headers
        headers = Headers({"Origin": "http://localhost:8765"})
        req = Request(path="/ws", headers=headers)
        resp = await handler(None, req)
        assert resp is None

    @pytest.mark.asyncio
    async def test_ws_path_with_hostile_origin_rejected(self, tmp_path):
        """WebSocket /ws with non-loopback Origin returns 403."""
        root = str(tmp_path)
        handler = create_process_request(spa_dir=root)

        from websockets.http11 import Request
        from websockets.datastructures import Headers
        headers = Headers({"Origin": "http://evil.com"})
        req = Request(path="/ws", headers=headers)
        resp = await handler(None, req)
        assert resp is not None
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_ws_path_with_missing_origin_allowed(self, tmp_path):
        """Internal clients without Origin header can connect."""
        root = str(tmp_path)
        handler = create_process_request(spa_dir=root)

        from websockets.http11 import Request
        from websockets.datastructures import Headers
        req = Request(path="/ws", headers=Headers())
        resp = await handler(None, req)
        assert resp is None

    @pytest.mark.asyncio
    async def test_ws_query_with_loopback_origin(self, tmp_path):
        """/ws?query with valid loopback Origin proceeds (WS upgrade)."""
        root = str(tmp_path)
        handler = create_process_request(spa_dir=root)

        from websockets.http11 import Request
        from websockets.datastructures import Headers
        headers = Headers({"Origin": "http://localhost:8765"})
        req = Request(path="/ws?room=abc", headers=headers)
        resp = await handler(None, req)
        assert resp is None

    @pytest.mark.asyncio
    async def test_ws_query_with_hostile_origin_rejected(self, tmp_path):
        """/ws?query with non-loopback Origin returns 403."""
        root = str(tmp_path)
        handler = create_process_request(spa_dir=root)

        from websockets.http11 import Request
        from websockets.datastructures import Headers
        headers = Headers({"Origin": "http://evil.com"})
        req = Request(path="/ws?token=x", headers=headers)
        resp = await handler(None, req)
        assert resp is not None
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_ws_query_with_missing_origin_allowed(self, tmp_path):
        """/ws?query without Origin header — allowed (non-browser client)."""
        root = str(tmp_path)
        handler = create_process_request(spa_dir=root)

        from websockets.http11 import Request
        from websockets.datastructures import Headers
        req = Request(path="/ws?foo=bar", headers=Headers())
        resp = await handler(None, req)
        assert resp is None

    @pytest.mark.asyncio
    async def test_http_path_with_hostile_origin_still_serves(self, tmp_path):
        """Static file requests don't validate Origin — only WS does."""
        root = str(tmp_path)
        (tmp_path / "index.html").write_text("ok")
        handler = create_process_request(spa_dir=root)

        from websockets.http11 import Request
        from websockets.datastructures import Headers
        headers = Headers({"Origin": "http://evil.com"})
        req = Request(path="/", headers=headers)
        resp = await handler(None, req)
        assert resp is not None
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_no_spa_dir_returns_503(self, tmp_path):
        """When no SPA directory is configured, return 503."""
        handler = create_process_request(spa_dir=None)

        from websockets.http11 import Request
        from websockets.datastructures import Headers
        req = Request(path="/", headers=Headers())
        resp = await handler(None, req)
        assert resp is not None
        assert resp.status_code == 503
