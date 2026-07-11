"""
HTTP request handler for the Liveflow dashboard server.

Provides static file serving, SPA fallback, health checks, and
loopback Origin validation — all through websockets' process_request
hook so the same port serves both HTTP (dashboard) and WebSocket (data).

Protocol:
- GET /ws with valid Origin (loopback or missing) → None (WebSocket upgrade)
- GET /ws with hostile Origin → 403
- GET /healthz → 200 {"status":"ok"}
- GET /* → static file from SPA dir, with SPA fallback to index.html
- No SPA dir configured → 503
"""

from __future__ import annotations

import logging
import mimetypes
import os
import os.path
import urllib.parse
from pathlib import Path
from typing import Optional

from websockets.datastructures import Headers
from websockets.http11 import Request, Response

logger = logging.getLogger("liveflow.http_handler")

# ---------------------------------------------------------------------------
# MIME types — explicit map for deterministic types; fallback to mimetypes
# ---------------------------------------------------------------------------

_MIME_MAP: dict[str, str] = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".eot": "application/vnd.ms-fontobject",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".wasm": "application/wasm",
}


def _get_mime_type(path: str) -> str:
    """Return the MIME type for a file path."""
    ext = os.path.splitext(path)[1].lower()
    if ext in _MIME_MAP:
        return _MIME_MAP[ext]
    guessed, _ = mimetypes.guess_type(path)
    return guessed or "application/octet-stream"


# ---------------------------------------------------------------------------
# Safe path resolution
# ---------------------------------------------------------------------------

def _is_safe_path(root: str, rel: str) -> Optional[str]:
    """
    Check if *rel* resolves safely inside *root*.

    Returns the resolved absolute path, or None if the path escapes root
    or contains dangerous sequences.
    """
    # Reject null bytes
    if "\x00" in rel:
        return None

    # URL-decode before checking (catches encoded traversal)
    try:
        decoded = urllib.parse.unquote(rel)
    except Exception:
        return None

    # Reject empty path
    if not decoded:
        return None

    # Strip leading slash for relative resolution
    clean = decoded.lstrip("/")

    # Resolve and verify it stays within root
    resolved = os.path.realpath(os.path.join(root, clean))
    root_real = os.path.realpath(root)

    if os.path.commonpath([resolved, root_real]) != root_real:
        return None

    return resolved


# Structured return from _resolve_static_path:
# ("healthz", None)      — health check endpoint
# ("file", <path>)       — exact file to serve
# ("not_found", None)    — safe path but no file + no index.html fallback
# ("traversal", None)    — path escaped the SPA root
_RESOLVE_HEALTHZ = "healthz"
_RESOLVE_FILE = "file"
_RESOLVE_NOT_FOUND = "not_found"
_RESOLVE_TRAVERSAL = "traversal"


def _resolve_static_path(spa_dir: str, request_path: str) -> tuple[str, Optional[str]]:
    """
    Map an HTTP request path to a file path in the SPA directory.

    Returns (status, path) where status is one of:
    - "healthz": health check endpoint
    - "file": path is the absolute file path to serve
    - "not_found": safe path but file doesn't exist and no index.html fallback
    - "traversal": path attempted to escape the SPA root
    """
    # Strip query string
    path_only = request_path.split("?")[0]

    # Health endpoint
    if path_only == "/healthz":
        return (_RESOLVE_HEALTHZ, None)

    # Normalize: strip leading slash for relative join
    rel = path_only.lstrip("/")
    if not rel:
        rel = "index.html"

    # Safety check
    safe = _is_safe_path(spa_dir, rel)
    if safe is None:
        return (_RESOLVE_TRAVERSAL, None)

    # If the resolved path is a regular file, serve it
    if os.path.isfile(safe):
        return (_RESOLVE_FILE, safe)

    # If it's a directory, don't serve (no directory listing)
    if os.path.isdir(safe):
        return (_RESOLVE_NOT_FOUND, None)

    # SPA fallback: return index.html
    index_path = os.path.join(spa_dir, "index.html")
    if os.path.isfile(index_path):
        return (_RESOLVE_FILE, index_path)

    return (_RESOLVE_NOT_FOUND, None)


# ---------------------------------------------------------------------------
# Origin validation
# ---------------------------------------------------------------------------

_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "[::1]", "::1"})


def _validate_origin(origin: Optional[str]) -> bool:
    """
    Validate that the Origin header belongs to a loopback address.

    Allows missing/empty Origin (non-browser or internal clients).
    Rejects non-loopback browser origins.
    """
    if not origin:
        return True  # missing/empty = non-browser client

    # Parse the origin URL to extract host
    try:
        # Handle origins like "http://localhost:8765" or "https://127.0.0.1"
        if "://" not in origin:
            return False
        host_part = origin.split("://", 1)[1]
        # Strip port and brackets from IPv6
        if host_part.startswith("["):
            # IPv6: [::1]:8765 → extract ::1
            bracket_end = host_part.find("]")
            if bracket_end == -1:
                return False
            host = host_part[1:bracket_end]
        else:
            # IPv4 / hostname: strip port
            host = host_part.split(":")[0]
    except Exception:
        return False

    return host.lower() in _LOOPBACK_HOSTS


# ---------------------------------------------------------------------------
# SPA directory discovery
# ---------------------------------------------------------------------------

def find_spa_dir() -> Optional[str]:
    """
    Locate the SPA build directory.

    Priority:
    1. Environment variable LIVEFLOW_SPA_DIR (canonical)
    2. packages/webview/dist (source tree, walking up from cwd)
    3. liveflow/_web (frozen, relative to this module's __file__)
    """
    # Explicit override (canonical)
    env_dir = os.environ.get("LIVEFLOW_SPA_DIR")
    if env_dir and os.path.isdir(env_dir) and os.path.isfile(os.path.join(env_dir, "index.html")):
        return env_dir

    # Source tree: walk up from cwd to find monorepo root
    cwd = os.getcwd()
    search = os.path.abspath(cwd)
    for _ in range(6):  # Max 6 levels up
        candidate = os.path.join(search, "packages", "webview", "dist")
        if os.path.isdir(candidate) and os.path.isfile(os.path.join(candidate, "index.html")):
            return candidate
        parent = os.path.dirname(search)
        if parent == search:
            break  # Reached filesystem root
        search = parent

    # Frozen: liveflow/_web relative to this module
    module_dir = os.path.dirname(os.path.abspath(__file__))
    frozen_dir = os.path.join(module_dir, "_web")
    if os.path.isdir(frozen_dir) and os.path.isfile(os.path.join(frozen_dir, "index.html")):
        return frozen_dir

    return None


# ---------------------------------------------------------------------------
# process_request factory
# ---------------------------------------------------------------------------

def create_process_request(spa_dir: Optional[str]):
    """
    Create a process_request callback for websockets.serve.

    The callback decides:
    - Return None → websockets handles the connection as WebSocket
    - Return Response → serve HTTP response

    WebSocket upgrades on /ws get Origin validation.
    All other paths get static file serving from *spa_dir*.
    """

    async def _handler(connection, request: Request) -> Optional[Response]:
        path = request.path
        headers = request.headers

        # --- WebSocket path ---
        if path.split("?")[0] == "/ws":
            origin = headers.get("Origin")
            if not _validate_origin(origin):
                logger.warning(f"Rejected WS connection from Origin: {origin}")
                return Response(
                    403,
                    "Forbidden",
                    Headers({"Content-Type": "text/plain"}),
                    b"Origin not allowed",
                )
            # Valid — let websockets handle the upgrade
            return None

        # --- HTTP paths ---
        # Health check works even without SPA dir
        if path.split("?")[0] == "/healthz":
            return Response(
                200,
                "OK",
                Headers({"Content-Type": "application/json"}),
                b'{"status":"ok"}',
            )

        # Static file serving (requires SPA dir)
        if spa_dir is None:
            return Response(
                503,
                "Service Unavailable",
                Headers({"Content-Type": "text/plain"}),
                b"Dashboard not built",
            )

        status, file_path = _resolve_static_path(spa_dir, path)

        if status == _RESOLVE_TRAVERSAL:
            return Response(
                403,
                "Forbidden",
                Headers({"Content-Type": "text/plain"}),
                b"Forbidden",
            )

        if status == _RESOLVE_NOT_FOUND:
            return Response(
                404,
                "Not Found",
                Headers({"Content-Type": "text/plain"}),
                b"Not Found",
            )

        if status == _RESOLVE_HEALTHZ:
            return Response(
                200,
                "OK",
                Headers({"Content-Type": "application/json"}),
                b'{"status":"ok"}',
            )

        # status == _RESOLVE_FILE
        assert file_path is not None

        try:
            with open(file_path, "rb") as f:
                body = f.read()
        except FileNotFoundError:
            return Response(
                404,
                "Not Found",
                Headers({"Content-Type": "text/plain"}),
                b"Not Found",
            )
        except PermissionError:
            return Response(
                403,
                "Forbidden",
                Headers({"Content-Type": "text/plain"}),
                b"Forbidden",
            )
        except OSError:
            return Response(
                500,
                "Internal Server Error",
                Headers({"Content-Type": "text/plain"}),
                b"Internal Server Error",
            )

        mime_type = _get_mime_type(file_path)
        return Response(
            200,
            "OK",
            Headers({
                "Content-Type": mime_type,
                "Content-Length": str(len(body)),
                "Cache-Control": "no-cache" if file_path.endswith("index.html") else "public, max-age=3600",
            }),
            body,
        )

    return _handler
