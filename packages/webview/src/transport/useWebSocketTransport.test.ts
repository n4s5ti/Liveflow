import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useWebSocketTransport } from "./useWebSocketTransport";
import { useLiveflowStore } from "@/store";

// ---------------------------------------------------------------------------
// Mock WebSocket — gives tests control over lifecycle events
// ---------------------------------------------------------------------------

const instances: MockWebSocket[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: ((this: WebSocket, ev: Event) => void) | null = null;
  onclose: ((this: WebSocket, ev: CloseEvent) => void) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => void) | null = null;
  onerror: ((this: WebSocket, ev: Event) => void) | null = null;
  sent: string[] = [];
  private _closed = false;

  constructor(url: string) {
    this.url = url;
    instances.push(this);
  }

  send(data: string) {
    if (this._closed) throw new Error("WebSocket is closed");
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this._closed = true;
    this.readyState = MockWebSocket.CLOSED;
    const event = new CloseEvent("close", {
      code: code ?? 1000,
      reason: reason ?? "",
      wasClean: code === 1000,
    }) as CloseEvent;
    queueMicrotask(() => this.onclose?.call(this as unknown as WebSocket, event));
  }

  // ---- Test helpers ----

  _open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.call(this as unknown as WebSocket, new Event("open"));
  }

  _message(data: unknown) {
    this.onmessage?.call(
      this as unknown as WebSocket,
      new MessageEvent("message", { data: JSON.stringify(data) }),
    );
  }

  _rawMessage(raw: string) {
    this.onmessage?.call(
      this as unknown as WebSocket,
      new MessageEvent("message", { data: raw }),
    );
  }

  _errorThenClose(code: number = 1006) {
    this.onerror?.call(this as unknown as WebSocket, new Event("error"));
    this._closed = true;
    this.readyState = MockWebSocket.CLOSED;
    const event = new CloseEvent("close", { code, wasClean: false }) as CloseEvent;
    queueMicrotask(() => this.onclose?.call(this as unknown as WebSocket, event));
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  instances.length = 0;
  vi.useFakeTimers({ shouldAdvanceTime: false });

  // Reset the store between tests
  useLiveflowStore.getState().reset();

  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal("location", {
    protocol: "http:",
    host: "127.0.0.1:8765",
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helper: render the hook and drain the effect microtasks
// ---------------------------------------------------------------------------
async function renderTransport(config = {}) {
  const renderResult = renderHook(
    (props = config) => useWebSocketTransport(props),
    { initialProps: config },
  );
  await act(() => Promise.resolve());
  return renderResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("URL resolution", () => {
  it("uses /ws path", async () => {
    await renderTransport();
    expect(instances[0].url).toBe("ws://127.0.0.1:8765/ws");
  });

  it("uses wss under HTTPS", async () => {
    vi.stubGlobal("location", { protocol: "https:", host: "liveflow.local" });
    await renderTransport();
    expect(instances[0].url).toBe("wss://liveflow.local/ws");
  });
});

describe("connection lifecycle", () => {
  it("opens with connecting state, transitions to connected on open", async () => {
    const { result } = await renderTransport();
    expect(result.current.connectionState).toBe("connecting");

    await act(async () => {
      instances[0]._open();
      await Promise.resolve();
    });

    expect(result.current.connectionState).toBe("connected");
    expect(useLiveflowStore.getState().connected).toBe(true);
  });

  it("dispatches valid messages to the store handleMessage", async () => {
    await renderTransport();
    const ws = instances[instances.length - 1];
    await act(async () => {
      ws._open();
      await Promise.resolve();
    });

    const msg = {
      type: "agent_state",
      agent_id: "agent-1",
      new_state: "thinking",
      timestamp: "2026-01-01T00:00:00Z",
    };
    await act(async () => {
      ws._message(msg);
      await Promise.resolve();
    });

    const state = useLiveflowStore.getState();
    expect(state.agentState).toBe("thinking");
    expect(state.currentAgentId).toBe("agent-1");
  });

  it("does not crash on malformed JSON", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = await renderTransport();
    const ws = instances[instances.length - 1];
    await act(async () => {
      ws._open();
      await Promise.resolve();
    });

    await act(async () => {
      ws._rawMessage("not json {{{");
      await Promise.resolve();
    });

    expect(result.current.connectionState).toBe("connected");
    warnSpy.mockRestore();
  });

  it("ignores messages without a string type field", async () => {
    await renderTransport();
    const ws = instances[instances.length - 1];
    await act(async () => {
      ws._open();
      await Promise.resolve();
    });

    await act(async () => {
      ws._message({ type: 42, data: "stuff" });
      await Promise.resolve();
    });

    const state = useLiveflowStore.getState();
    expect(state.sessionStarted).toBe(false);
  });

  it("ignores pong messages", async () => {
    await renderTransport();
    const ws = instances[instances.length - 1];
    await act(async () => {
      ws._open();
      await Promise.resolve();
    });

    await act(async () => {
      ws._message({ type: "pong" });
      await Promise.resolve();
    });

    const state = useLiveflowStore.getState();
    expect(state.sessionStarted).toBe(false);
  });
});

describe("StrictMode / remount", () => {
  it("creates a fresh connection after unmount and new mount", async () => {
    const { result, unmount } = await renderTransport();
    await act(async () => {
      instances[0]._open();
      await Promise.resolve();
    });
    expect(result.current.connectionState).toBe("connected");

    const firstWs = instances[0];
    const countBefore = instances.length;

    // Unmount — effect cleanup closes the socket
    unmount();
    await act(async () => {
      firstWs.close(1000, "Cleanup");
      await Promise.resolve();
    });

    // Fresh mount — a new component instance, so a new WebSocket is expected
    // (refs don't persist across separate renderHook calls — this is correct)
    const { result: result2 } = await renderTransport();
    expect(result2.current.connectionState).toBe("connecting");
    expect(instances.length).toBeGreaterThan(countBefore);
  });

  it("stays disconnected after disconnect() across rerenders", async () => {
    const { result, rerender } = await renderTransport();

    await act(async () => {
      instances[0]._open();
      await Promise.resolve();
    });
    expect(result.current.connectionState).toBe("connected");

    // User explicitly disconnects
    await act(async () => {
      result.current.disconnect();
      await Promise.resolve();
    });
    expect(result.current.connectionState).toBe("disconnected");
    expect(useLiveflowStore.getState().connected).toBe(false);

    const countBefore = instances.length;

    // Rerender with new props — should stay disconnected, no new WS
    rerender({ initialBackoffMs: 200 });
    await act(() => Promise.resolve());

    expect(result.current.connectionState).toBe("disconnected");
    expect(instances.length).toBe(countBefore);
  });
});

describe("reconnect behavior", () => {
  it("schedules reconnect on unexpected close", async () => {
    const { result } = await renderTransport();
    const ws = instances[instances.length - 1];
    await act(async () => {
      ws._open();
      await Promise.resolve();
    });
    expect(result.current.connectionState).toBe("connected");

    await act(async () => {
      ws._errorThenClose(1006);
      await Promise.resolve();
    });

    expect(result.current.connectionState).toBe("reconnecting");
    expect(useLiveflowStore.getState().connected).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(instances.length).toBeGreaterThan(1);
  });

  it("does not reconnect on clean close (code 1000)", async () => {
    const { result } = await renderTransport();
    const ws = instances[instances.length - 1];
    await act(async () => {
      ws._open();
      await Promise.resolve();
    });

    await act(async () => {
      ws.close(1000, "Normal closure");
      await Promise.resolve();
    });

    expect(result.current.connectionState).toBe("disconnected");
  });

  it("gives up after max reconnect attempts", async () => {
    const { result } = await renderTransport({
      maxReconnectAttempts: 2,
      initialBackoffMs: 500,
    });

    await act(async () => {
      instances[0]._open();
      await Promise.resolve();
    });

    // First close → reconnect attempt 1
    await act(async () => {
      instances[0]._errorThenClose(1006);
      await Promise.resolve();
    });
    expect(result.current.connectionState).toBe("reconnecting");

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    // Second close → reconnect attempt 2 (now at max)
    await act(async () => {
      instances[1]._errorThenClose(1006);
      await Promise.resolve();
    });
    expect(result.current.connectionState).toBe("reconnecting");

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    // Third close → exhausted, transition to disconnected
    await act(async () => {
      const last = instances[instances.length - 1];
      last._errorThenClose(1006);
      await Promise.resolve();
    });

    expect(result.current.connectionState).toBe("disconnected");
  });

  it("uses updated config after rerender for reconnect backoff", async () => {
    const { result, rerender } = await renderTransport({
      initialBackoffMs: 5000,
      maxReconnectAttempts: 1,
    });

    await act(async () => {
      instances[0]._open();
      await Promise.resolve();
    });

    // Rerender with a much shorter backoff
    rerender({ initialBackoffMs: 200, maxReconnectAttempts: 1 });

    // Trigger close
    await act(async () => {
      instances[0]._errorThenClose(1006);
      await Promise.resolve();
    });
    expect(result.current.connectionState).toBe("reconnecting");

    // The reconnect should use the NEW backoff (200ms), not the old (5000ms)
    // Advance the new backoff and verify reconnect happens
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    // A new WebSocket was created → reconnect used the updated config
    expect(instances.length).toBe(2);
  });
});

describe("explicit disconnect", () => {
  it("cancel reconnection on explicit disconnect", async () => {
    const { result } = await renderTransport();

    await act(async () => {
      instances[0]._open();
      await Promise.resolve();
    });

    await act(async () => {
      instances[0]._errorThenClose(1006);
      await Promise.resolve();
    });
    expect(result.current.connectionState).toBe("reconnecting");

    await act(async () => {
      result.current.disconnect();
      await Promise.resolve();
    });

    expect(result.current.connectionState).toBe("disconnected");

    const countBefore = instances.length;
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(instances.length).toBe(countBefore);
  });

  it("closes WebSocket and sets disconnected state", async () => {
    const { result } = await renderTransport();

    await act(async () => {
      instances[0]._open();
      await Promise.resolve();
    });
    expect(result.current.connectionState).toBe("connected");

    await act(async () => {
      result.current.disconnect();
      await Promise.resolve();
    });

    expect(result.current.connectionState).toBe("disconnected");
    expect(useLiveflowStore.getState().connected).toBe(false);
  });
});

describe("heartbeat", () => {
  it("sends ping at configured interval", async () => {
    await renderTransport({ pingIntervalMs: 5000 });

    await act(async () => {
      instances[0]._open();
      await Promise.resolve();
    });

    expect(instances[0].sent.filter((s) => s.includes("ping")).length).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(instances[0].sent.filter((s) => s.includes("ping")).length).toBe(1);
  });
});

describe("unmount cleanup", () => {
  it("cancels ping interval on unmount", async () => {
    const { unmount } = await renderTransport({ pingIntervalMs: 5000 });

    await act(async () => {
      instances[0]._open();
      await Promise.resolve();
    });

    // Advance partially into the interval
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    // Unmount the hook
    unmount();
    await act(async () => {
      instances[0].close(1000, "Cleanup");
      await Promise.resolve();
    });

    // Advance past where the ping would have fired
    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
    });

    // Still only 0 pings — the interval was cancelled on unmount
    expect(instances[0].sent.filter((s) => s.includes("ping")).length).toBe(0);
  });

  it("cancels reconnect timer on unmount", async () => {
    const { result, unmount } = await renderTransport({
      initialBackoffMs: 1000,
    });

    await act(async () => {
      instances[0]._open();
      await Promise.resolve();
    });

    // Trigger reconnect
    await act(async () => {
      instances[0]._errorThenClose(1006);
      await Promise.resolve();
    });
    expect(result.current.connectionState).toBe("reconnecting");

    // Unmount before the reconnect timer fires
    unmount();
    await act(() => Promise.resolve());

    const countBefore = instances.length;

    // Advance past the backoff window
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    // No new WebSocket created after unmount
    expect(instances.length).toBe(countBefore);
  });

  it("closes WebSocket on unmount", async () => {
    const { unmount } = await renderTransport();

    await act(async () => {
      instances[0]._open();
      await Promise.resolve();
    });

    const ws = instances[instances.length - 1];
    expect(ws.readyState).toBe(MockWebSocket.OPEN);

    unmount();
    await act(() => Promise.resolve());

    // After the close microtask fires
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });
});

describe("stale-socket immunity (StrictMode simulation)", () => {
  it("stale onclose from replaced socket does not clear active socket", async () => {
    // Strategy: let the hook create WS1, then trigger WS1 close which
    // schedules a reconnect. Let the reconnect create WS2. Then fire
    // WS1.onclose again — the instance guard (wsRef.current !== ws)
    // must prevent it from clearing WS2's timers and state.
    const { result } = await renderTransport({
      initialBackoffMs: 50,
      maxReconnectAttempts: 1,
    });
    const ws1 = instances[0];

    await act(async () => {
      ws1._open();
      await Promise.resolve();
    });
    expect(result.current.connectionState).toBe("connected");

    // Close WS1 unexpectedly → schedules reconnect
    await act(async () => {
      ws1._errorThenClose(1006);
      await Promise.resolve();
    });
    expect(result.current.connectionState).toBe("reconnecting");

    // Advance timer so reconnect creates WS2
    await act(async () => {
      vi.advanceTimersByTime(50);
      await Promise.resolve();
    });

    const ws2 = instances[1];
    await act(async () => {
      ws2._open();
      await Promise.resolve();
    });
    expect(result.current.connectionState).toBe("connected");

    // Fire ws1.onclose again — stale event, must be ignored
    // because wsRef.current now points to ws2
    await act(async () => {
      ws1.close(1006, "Stale close");
      await Promise.resolve();
    });

    // WS2 should still be connected and store connected = true
    expect(result.current.connectionState).toBe("connected");
    expect(useLiveflowStore.getState().connected).toBe(true);
  });
});
