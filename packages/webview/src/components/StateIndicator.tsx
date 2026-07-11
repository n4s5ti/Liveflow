import React, { useState, useEffect } from "react";
import { useLiveflowStore } from "@/store";
import type { AgentState, UserState } from "@/types";

// Agent state → icon + color
const AGENT_STATE_CONFIG: Record<AgentState, { icon: string; color: string; label: string }> = {
  initializing: { icon: "⚙️", color: "#888", label: "Initializing" },
  idle: { icon: "💤", color: "#888", label: "Idle" },
  listening: { icon: "👂", color: "#22c55e", label: "Listening" },
  thinking: { icon: "🧠", color: "#eab308", label: "Thinking" },
  speaking: { icon: "🗣️", color: "#3b82f6", label: "Speaking" },
};

// User state → icon  
const USER_STATE_CONFIG: Record<UserState, { icon: string; color: string; label: string }> = {
  speaking: { icon: "🎤", color: "#22c55e", label: "Speaking" },
  listening: { icon: "🔇", color: "#888", label: "Silent" },
  away: { icon: "👋", color: "#ef4444", label: "Away" },
};

function SessionTimer({ startTime }: { startTime: string | null }) {
  const [elapsed, setElapsed] = useState("00:00");

  useEffect(() => {
    if (!startTime) return;

    const start = new Date(startTime).getTime();
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - start) / 1000);
      const mins = Math.floor(diff / 60).toString().padStart(2, "0");
      const secs = (diff % 60).toString().padStart(2, "0");
      setElapsed(`${mins}:${secs}`);
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime]);

  return (
    <span style={{ fontFamily: "monospace", fontSize: 12, color: "#888" }}>
      {elapsed}
    </span>
  );
}

export function StateIndicator() {
  const connected = useLiveflowStore((s) => s.connected);
  const currentAgentId = useLiveflowStore((s) => s.currentAgentId);
  const agents = useLiveflowStore((s) => s.agents);
  const agentState = useLiveflowStore((s) => s.agentState);
  const userState = useLiveflowStore((s) => s.userState);
  const sessionStartTime = useLiveflowStore((s) => s.sessionStartTime);
  const toolCalls = useLiveflowStore((s) => s.toolCalls);
  const errors = useLiveflowStore((s) => s.errors);

  const currentAgent = agents.find((a) => a.id === currentAgentId);
  const agentConfig = AGENT_STATE_CONFIG[agentState] || AGENT_STATE_CONFIG.idle;
  const userConfig = USER_STATE_CONFIG[userState] || USER_STATE_CONFIG.listening;
  const runningTools = toolCalls.filter((t) => t.status === "running").length;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "8px 16px",
        background: "var(--liveflow-titleBar-activeBackground, #1a1a2e)",
        borderBottom: "1px solid #333",
        flexShrink: 0,
        flexWrap: "wrap",
      }}
    >
      {/* Connection status */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: connected ? "#22c55e" : "#ef4444",
            boxShadow: connected ? "0 0 6px #22c55e" : "0 0 6px #ef4444",
            animation: connected ? undefined : "pulse 2s infinite",
          }}
        />
        <span style={{ fontSize: 11, color: connected ? "#22c55e" : "#ef4444" }}>
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 16, background: "#444" }} />

      {/* Current agent + state */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 14 }}>{agentConfig.icon}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: agentConfig.color }}>
          {currentAgent?.name || currentAgentId || "—"}
        </span>
        <span
          style={{
            fontSize: 10,
            padding: "2px 8px",
            borderRadius: 10,
            background: `${agentConfig.color}22`,
            color: agentConfig.color,
            border: `1px solid ${agentConfig.color}44`,
          }}
        >
          {agentConfig.label}
        </span>
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 16, background: "#444" }} />

      {/* User state */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 14 }}>{userConfig.icon}</span>
        <span style={{ fontSize: 11, color: userConfig.color }}>{userConfig.label}</span>
      </div>

      {/* Running tools indicator */}
      {runningTools > 0 && (
        <>
          <div style={{ width: 1, height: 16, background: "#444" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⚡</span>
            <span style={{ fontSize: 11, color: "#eab308" }}>
              {runningTools} tool{runningTools > 1 ? "s" : ""} running
            </span>
          </div>
        </>
      )}

      {/* Errors count */}
      {errors.length > 0 && (
        <>
          <div style={{ width: 1, height: 16, background: "#444" }} />
          <span style={{ fontSize: 11, color: "#ef4444" }}>
            ⚠ {errors.length} error{errors.length > 1 ? "s" : ""}
          </span>
        </>
      )}

      {/* Session timer (pushed to the right) */}
      <div style={{ marginLeft: "auto" }}>
        <SessionTimer startTime={sessionStartTime} />
      </div>
    </div>
  );
}
