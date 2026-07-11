from __future__ import annotations

import asyncio
import json
import logging
import threading
from typing import Any, Optional, Set

import websockets
from websockets.asyncio.server import serve as ws_serve
from websockets.server import ServerConnection

from .http_handler import create_process_request
from .protocol import BaseMessage, PongMessage

logger = logging.getLogger("liveflow.ws_server")


class LiveflowServer:
    """
    Manages the WebSocket/HTTP server lifecycle.

    Usage:
        server = LiveflowServer()
        server.start()         # starts in a background thread
        server.broadcast(msg)  # send a message to all connected dashboard clients
        server.stop()          # clean shutdown
    """

    def __init__(self, host: str = "127.0.0.1", port: int = 0, spa_dir: Optional[str] = None, extra_origins: Optional[list[str]] = None):
        """
        Args:
            host: Bind address. 127.0.0.1 = localhost only (secure).
            port: Port number. 0 = OS picks a random available port.
            spa_dir: Path to the SPA build directory for static HTTP serving.
                     None disables static serving (WebSocket-only mode).
            extra_origins: Additional Origin hosts to allow beyond loopback
                           (e.g. tailnet FQDN for tailscale serve).
        """
        self._host = host
        self._port = port
        self._spa_dir = spa_dir
        self._extra_origins = extra_origins or []
        self._actual_port: Optional[int] = None

        # Connected WebSocket clients (dashboard, child forwarders)
        self._clients: Set[ServerConnection] = set()

        # Thread-safe queue: interceptor pushes JSON strings, server broadcasts them
        self._queue: asyncio.Queue[str] = asyncio.Queue()

        # Background thread and event loop
        self._thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._server: Optional[websockets.WebSocketServer] = None
        self._started = threading.Event()
        self._stop_event: Optional[asyncio.Event] = None

        # Stored initial code scan message — replayed to each new client
        self._initial_scan_json: Optional[str] = None
        # Stored session_init message — replayed to each new client
        self._session_init_json: Optional[str] = None

    @property
    def port(self) -> Optional[int]:
        """The actual port the server is listening on (available after start)."""
        return self._actual_port

    def start(self) -> int:
        """
        Start the WebSocket server in a background daemon thread.
        Returns the port number once the server is ready.
        
        This is called from the Liveflow launcher before running the user's agent.
        """
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="liveflow-ws")
        self._thread.start()
        
        # Wait for the server to be ready (blocks until port is available)
        self._started.wait(timeout=10)
        
        if self._actual_port is None:
            raise RuntimeError("Liveflow WebSocket server failed to start")

        logger.info(f"Liveflow server ready on ws://{self._host}:{self._actual_port}")
        return self._actual_port

    def broadcast(self, message: BaseMessage) -> None:
        """
        Queue a message for broadcast to all connected clients.
        Thread-safe — can be called from any thread (the interceptor runs 
        in the LiveKit agent's asyncio loop, which may be a different thread).
        """
        try:
            json_str = message.model_dump_json()
            if self._loop and not self._loop.is_closed():
                self._loop.call_soon_threadsafe(self._queue.put_nowait, json_str)
        except Exception as e:
            logger.warning(f"Failed to queue message: {e}")

    def set_initial_scan(self, message: BaseMessage) -> None:
        """
        Store the code scan message so it can be replayed to each new client.
        Also broadcasts it immediately to any already-connected clients.
        """
        self._initial_scan_json = message.model_dump_json()
        self.broadcast(message)

    def set_session_init(self, message: BaseMessage) -> None:
        """
        Store the session_init message so it can be replayed to each new client.
        Also broadcasts it immediately to any already-connected clients.
        """
        self._session_init_json = message.model_dump_json()
        self.broadcast(message)

    def stop(self) -> None:
        """Gracefully shut down the server."""
        if self._loop and self._stop_event:
            self._loop.call_soon_threadsafe(self._stop_event.set)
        if self._thread:
            self._thread.join(timeout=5)
        logger.info("Liveflow server stopped")

    # ---- Internal methods ----

    def _run_loop(self) -> None:
        """Background thread entry: creates an event loop and runs the server."""
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._stop_event = asyncio.Event()
        try:
            self._loop.run_until_complete(self._serve())
        except Exception as e:
            logger.error(f"Liveflow server error: {e}")
        finally:
            self._loop.close()

    async def _serve(self) -> None:
        """Async server main: start WebSocket server + broadcast loop."""
        # Create the HTTP/WS request router
        process_request = create_process_request(spa_dir=self._spa_dir, extra_origins=self._extra_origins)

        # Start the WebSocket server with process_request for static HTTP
        self._server = await ws_serve(
            self._handle_client,
            self._host,
            self._port,
            process_request=process_request,
        )

        # Discover the actual port (important when port=0)
        for sock in self._server.sockets:
            addr = sock.getsockname()
            self._actual_port = addr[1]
            break

        self._started.set()

        # Run broadcast loop until stop is requested
        broadcast_task = asyncio.create_task(self._broadcast_loop())
        
        await self._stop_event.wait()
        
        broadcast_task.cancel()
        self._server.close()
        await self._server.wait_closed()

    async def _handle_client(self, websocket: ServerConnection) -> None:
        """
        Handle a new WebSocket client connection.

        Clients can be:
        - Dashboard (consumer) — sends pings, receives broadcasts
        - Child process forwarder (producer) — sends intercepted events

        Any non-ping message received from a client is re-queued for broadcast
        to all OTHER clients. This way, events from child process forwarders
        reach the dashboard.
        """
        self._clients.add(websocket)
        client_addr = websocket.remote_address
        logger.info(f"Client connected: {client_addr}")
        
        # Replay stored messages to this new client (code_scan first, then session_init)
        for label, json_str in [("code_scan", self._initial_scan_json), ("session_init", self._session_init_json)]:
            if json_str:
                try:
                    await websocket.send(json_str)
                    logger.debug(f"Replayed {label} to {client_addr}")
                except Exception as e:
                    logger.warning(f"Failed to replay {label}: {e}")
        
        try:
            async for raw_message in websocket:
                try:
                    data = json.loads(raw_message)
                    msg_type = data.get("type", "")
                    
                    if msg_type == "ping":
                        # Respond to pings (from dashboard)
                        pong = PongMessage(session_id="")
                        await websocket.send(pong.model_dump_json())
                    else:
                        # Re-broadcast to all OTHER clients (from child forwarder → dashboard)
                        raw_str = raw_message if isinstance(raw_message, str) else raw_message.decode("utf-8")
                        disconnected = set()
                        for client in self._clients.copy():
                            if client is websocket:
                                continue  # don't echo back to sender
                            try:
                                await client.send(raw_str)
                            except websockets.ConnectionClosed:
                                disconnected.add(client)
                            except Exception as e:
                                logger.warning(f"Failed to relay to client: {e}")
                                disconnected.add(client)
                        self._clients -= disconnected
                        
                except json.JSONDecodeError:
                    pass
        except websockets.ConnectionClosed:
            pass
        finally:
            self._clients.discard(websocket)
            logger.info(f"Client disconnected: {client_addr}")

    async def _broadcast_loop(self) -> None:
        """
        Continuously pull messages from the queue and send to all connected clients.
        This runs as a background task in the server's event loop.
        """
        while True:
            try:
                json_str = await self._queue.get()
                
                if not self._clients:
                    continue  # No clients connected, drop the message
                
                # Broadcast to all connected clients
                disconnected = set()
                for client in self._clients.copy():
                    try:
                        await client.send(json_str)
                    except websockets.ConnectionClosed:
                        disconnected.add(client)
                    except Exception as e:
                        logger.warning(f"Failed to send to client: {e}")
                        disconnected.add(client)
                
                self._clients -= disconnected
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"Broadcast error: {e}")


# Module-level singleton (created by the launcher, used by the interceptor)
_server: Optional[LiveflowServer] = None


def get_server() -> Optional[LiveflowServer]:
    """Get the global Liveflow server instance."""
    return _server


def start_server(host: str = "127.0.0.1", port: int = 0, spa_dir: Optional[str] = None, extra_origins: Optional[list[str]] = None) -> LiveflowServer:
    """Create and start the global Liveflow server. Returns the server instance."""
    global _server
    _server = LiveflowServer(host=host, port=port, spa_dir=spa_dir, extra_origins=extra_origins)
    _server.start()
    return _server
