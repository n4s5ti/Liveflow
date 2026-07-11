import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLiveflowStore } from "@/store";
import type { ConnectionState, TransportConfig } from "./types";
import { DEFAULT_CONFIG, resolveWsUrl } from "./types";

/**
 * Browser-native WebSocket transport for Liveflow.
 *
 * Opens a WebSocket to `ws(s)://<host>/ws`, dispatches incoming JSON messages
 * to the Zustand store, and manages reconnect with bounded exponential backoff.
 *
 * React StrictMode (double-mount in dev) is handled correctly: effect cleanup
 * tears down the socket without setting the permanent disposed flag, so the
 * remount creates a fresh connection.
 *
 * @returns connectionState — for displaying connection status in the UI
 * @returns disconnect    — explicit permanent teardown (cancels reconnect, closes socket)
 */
export function useWebSocketTransport(
  config: TransportConfig = {},
): {
  connectionState: ConnectionState;
  disconnect: () => void;
} {
  const merged = useMemo(() => ({ ...DEFAULT_CONFIG, ...config }), [config]);

  // Keep config in a ref so reconnect closures always read the latest values
  const configRef = useRef(merged);
  configRef.current = merged;

  // Stable store action references (Zustand selectors return stable refs)
  const handleMessage = useLiveflowStore((s) => s.handleMessage);
  const setConnected = useLiveflowStore((s) => s.setConnected);

  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");

  // ------- Mutable state kept in refs (no re-render needed) -------
  const wsRef = useRef<WebSocket | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  // Permanent user-disconnect flag — NOT set by effect cleanup
  const disposedRef = useRef(false);

  // ------- Timer cleanup helper -------
  const clearAllTimers = useCallback(() => {
    if (pingTimerRef.current !== null) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  // ------- connect — creates and wires a WebSocket -------
  const connect = useCallback(() => {
    if (disposedRef.current) return;

    const url = resolveWsUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      // Guard: ignore events from a socket that's no longer the active one
      // (e.g. StrictMode double-mount where WS1's onopen fires after WS2 was created)
      if (wsRef.current !== ws) return;
      if (disposedRef.current) {
        ws.close(1000);
        return;
      }
      attemptRef.current = 0;
      setConnectionState("connected");
      setConnected(true);

      // Start heartbeat ping
      const cfg = configRef.current;
      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, cfg.pingIntervalMs);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (wsRef.current !== ws) return;
      if (disposedRef.current) return;

      let msg: unknown;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        // Malformed JSON — log and ignore
        console.warn("[Liveflow] Malformed WebSocket message received");
        return;
      }

      // Validate: must be an object with a string `type` field
      if (
        msg &&
        typeof msg === "object" &&
        typeof (msg as Record<string, unknown>).type === "string"
      ) {
        const type = (msg as Record<string, unknown>).type as string;
        // Skip internal pong echo
        if (type === "pong") return;
        handleMessage(msg as Parameters<typeof handleMessage>[0]);
      }
    };

    ws.onclose = (event: CloseEvent) => {
      // Guard: ignore close events from a stale socket that was already replaced.
      // Without this, a delayed WS1.onclose clears WS2's timers and wsRef.
      if (wsRef.current !== ws) return;
      if (disposedRef.current) return;

      clearAllTimers();
      wsRef.current = null;
      setConnected(false);

      // Clean client-initiated close — don't reconnect
      if (event.code === 1000) {
        setConnectionState("disconnected");
        return;
      }

      // Reconnect with exponential backoff using current config
      const cfg = configRef.current;
      if (attemptRef.current < cfg.maxReconnectAttempts) {
        setConnectionState("reconnecting");
        const delay = Math.min(
          cfg.initialBackoffMs * 2 ** attemptRef.current,
          cfg.maxBackoffMs,
        );
        attemptRef.current += 1;

        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, delay);
      } else {
        setConnectionState("disconnected");
      }
    };

    // onerror always precedes onclose — let onclose handle state transitions
    ws.onerror = () => {
      /* onclose will fire next */
    };
  }, [handleMessage, setConnected, clearAllTimers]);
  // configRef is a ref, intentionally excluded from deps

  // ------- Effect-level teardown (does NOT set disposedRef) -------
  // Separate from the user-facing disconnect so StrictMode remount works.
  const teardownEffect = useCallback(() => {
    clearAllTimers();
    if (wsRef.current) {
      wsRef.current.close(1000, "Cleanup");
      wsRef.current = null;
    }
    setConnectionState("disconnected");
    setConnected(false);
  }, [clearAllTimers, setConnected]);

  // ------- User-facing permanent disconnect -------
  const disconnect = useCallback(() => {
    disposedRef.current = true;
    teardownEffect();
  }, [teardownEffect]);

  // ------- Effect: connect on mount, tear down on unmount -------
  useEffect(() => {
    // If the user permanently disconnected (explicit disconnect() call),
    // don't attempt to reconnect on remount — just show disconnected state.
    if (disposedRef.current) {
      setConnectionState("disconnected");
      return;
    }
    connect();
    return () => {
      teardownEffect();
    };
  }, [connect, teardownEffect]);

  return { connectionState, disconnect };
}
