export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface TransportConfig {
  maxReconnectAttempts?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  pingIntervalMs?: number;
}

export const DEFAULT_CONFIG: Required<TransportConfig> = {
  maxReconnectAttempts: 5,
  initialBackoffMs: 1000,
  maxBackoffMs: 30000,
  pingIntervalMs: 30000,
};

/** Derive the WebSocket URL from window.location. */
export function resolveWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host || "127.0.0.1";
  return `${protocol}//${host}/ws`;
}
