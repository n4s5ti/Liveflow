// @ts-ignore – Vite inlines small assets as base64 data URLs
import iconUrl from "../../public/icon.png";
import type { ConnectionState } from "@/transport/types";

const SANS = "var(--liveflow-font-family, system-ui, sans-serif)";
const MONO = "var(--liveflow-editor-font-family, 'JetBrains Mono', monospace)";

function Step({
  number,
  title,
  code,
  description,
}: {
  number: number;
  title: string;
  code?: string;
  description?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#1e1e28",
          border: "1px solid #2e2e3a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontWeight: 600,
          color: "#555",
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        {number}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: "#c9c9c9", marginBottom: 5, fontFamily: SANS }}>{title}</div>
        {code && (
          <div
            style={{
              background: "#16161e",
              border: "1px solid #2a2a38",
              borderRadius: 5,
              padding: "6px 10px",
              fontSize: 11,
              fontFamily: MONO,
              color: "#aaa",
              wordBreak: "break-all",
              userSelect: "all",
            }}
          >
            {code}
          </div>
        )}
        {description && (
          <div style={{ fontSize: 11, color: "#666", marginTop: 4, fontFamily: SANS }}>{description}</div>
        )}
      </div>
    </div>
  );
}

// Per-state copy and styling for the connection indicator
const STATE_COPY: Record<
  ConnectionState,
  { label: string; color: string; animate?: boolean }
> = {
  connecting: { label: "Connecting to Liveflow...", color: "#eab308", animate: true },
  connected: { label: "Waiting for agent...", color: "#eab308", animate: true },
  reconnecting: {
    label: "Connection lost. Reconnecting...",
    color: "#f59e0b",
    animate: true,
  },
  disconnected: {
    label: "Unable to connect. Is Liveflow running?",
    color: "#ef4444",
    animate: false,
  },
};

export function WelcomeView({
  connectionState,
}: {
  connectionState: ConnectionState;
}) {
  const info = STATE_COPY[connectionState];

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--liveflow-editor-background, #121218)",
        color: "var(--liveflow-editor-foreground, #ccc)",
        fontFamily: SANS,
        padding: "24px 16px",
        textAlign: "center",
        gap: 24,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <img src={iconUrl} alt="Liveflow" style={{ width: 52, height: 52, borderRadius: 12 }} />
        <span
          style={{
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "#fff",
            fontFamily: SANS,
          }}
        >
          Liveflow
        </span>
        <span style={{ fontSize: 12, color: "#555", fontFamily: SANS, marginTop: -4 }}>
          Real-time visibility for LiveKit agents
        </span>
      </div>

      {/* Steps */}
      <div style={{ textAlign: "left", width: "100%", maxWidth: 320 }}>
        <p
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: "#555",
            margin: "0 0 14px",
            fontFamily: MONO,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Get started
        </p>
        <Step number={1} title="Install the Python package" code="pip install liveflow" />
        <Step number={2} title="Run your agent with Liveflow" code="liveflow agent.py dev" />
        <Step
          number={3}
          title="Dashboard connects automatically"
          description="This panel will light up once a running agent is detected."
        />
      </div>

      {/* Connection state indicator */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11,
          color: info.color,
          fontFamily: MONO,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: info.color,
            animation: info.animate ? "lf-pulse 2s ease-in-out infinite" : "none",
          }}
        />
        {info.label}
      </div>

      {/* Support links */}
      <div style={{ fontSize: 11, color: "#444", lineHeight: 1.8, fontFamily: SANS }}>
        <a
          href="mailto:2005lakshyapaliwal@gmail.com"
          style={{ color: "#3b82f6", textDecoration: "none" }}
        >
          Contact support
        </a>
        <span style={{ margin: "0 6px" }}>·</span>
        <a
          href="https://cal.com/lakshya-paliwal/30min"
          style={{ color: "#3b82f6", textDecoration: "none" }}
        >
          Book a call
        </a>
      </div>

      <style>{`
        @keyframes lf-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
