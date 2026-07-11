import React, { useState, useRef, useEffect } from "react";
import { useLiveflowStore } from "@/store";
import type { ToolCall } from "@/types";

// Colors matching AgentGraph
const AGENT_COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f97316", "#14b8a6", "#ef4444"];

function getAgentColor(agentId: string, agents: { id: string }[]): string {
  const idx = agents.findIndex((a) => a.id === agentId);
  return AGENT_COLORS[idx >= 0 ? idx % AGENT_COLORS.length : 0];
}

function StatusIcon({ status }: { status: ToolCall["status"] }) {
  switch (status) {
    case "running":
      return <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⏳</span>;
    case "success":
      return <span style={{ color: "#22c55e" }}>✓</span>;
    case "error":
      return <span style={{ color: "#ef4444" }}>✗</span>;
  }
}

function ToolCallRow({ call, color, isActive }: { call: ToolCall; color: string; isActive: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const time = new Date(call.timestamp).toLocaleTimeString();

  return (
    <div
      style={{
        borderLeft: `3px solid ${color}`,
        padding: "8px 12px",
        marginBottom: 4,
        background: isActive
          ? `${color}11`
          : "var(--liveflow-editor-background, #1e1e1e)",
        borderRadius: "0 6px 6px 0",
        cursor: "pointer",
        transition: "all 0.3s ease",
        boxShadow: isActive ? `0 0 12px ${color}30` : "none",
      }}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <StatusIcon status={call.status} />
        <span style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 13, color: color }}>
          {call.tool_name}
        </span>
        <span style={{ fontSize: 11, color: "#888", marginLeft: "auto" }}>
          {call.duration_ms > 0 ? `${call.duration_ms.toFixed(0)}ms` : ""}
        </span>
        <span style={{ fontSize: 10, color: "#666" }}>{time}</span>
        {call.has_handoff && (
          <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, background: "#22c55e22", color: "#22c55e" }}>
            handoff
          </span>
        )}
        <span style={{ fontSize: 10, color: "#666" }}>{expanded ? "▾" : "▸"}</span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          {/* Arguments */}
          {call.arguments && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ color: "#888", fontSize: 10, marginBottom: 2 }}>ARGUMENTS</div>
              <pre
                style={{
                  background: "#111",
                  padding: 8,
                  borderRadius: 4,
                  overflow: "auto",
                  maxHeight: 120,
                  margin: 0,
                  color: "#ccc",
                  fontSize: 11,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {formatJson(call.arguments)}
              </pre>
            </div>
          )}

          {/* Output */}
          {call.output && (
            <div>
              <div style={{ color: "#888", fontSize: 10, marginBottom: 2 }}>OUTPUT</div>
              <pre
                style={{
                  background: "#111",
                  padding: 8,
                  borderRadius: 4,
                  overflow: "auto",
                  maxHeight: 120,
                  margin: 0,
                  color: call.status === "error" ? "#ef4444" : "#22c55e",
                  fontSize: 11,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {formatJson(call.output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Try to pretty-print JSON, fall back to raw string */
function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

export function ToolTimeline() {
  const toolCalls = useLiveflowStore((s) => s.toolCalls);
  const agents = useLiveflowStore((s) => s.agents);
  const activeToolCallId = useLiveflowStore((s) => s.activeToolCallId);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new tool calls arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [toolCalls.length]);

  // Gather all available tools from agents (for the "available tools" section)
  const allTools = agents.flatMap((a) =>
    a.tools.map((t) => ({ name: t, agentId: a.id, agentName: a.name }))
  );

  if (toolCalls.length === 0 && allTools.length === 0) {
    return (
      <div style={emptyStyle}>
        <div style={{ fontSize: 24, marginBottom: 4 }}>🔧</div>
        <div>No tool calls yet</div>
        <div style={{ fontSize: 11, color: "#666" }}>
          Tool executions will appear here in real-time
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} style={{ height: "100%", overflow: "auto", padding: 8 }}>
      {/* Available tools registry (from code scan) */}
      {allTools.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 6, fontWeight: 600 }}>
            AVAILABLE TOOLS ({allTools.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
            {allTools.map((t) => {
              const color = getAgentColor(t.agentId, agents);
              // Check if this tool is currently running
              const isRunning = activeToolCallId
                ? toolCalls.some((tc) => tc.call_id === activeToolCallId && tc.tool_name === t.name)
                : false;
              return (
                <span
                  key={`${t.agentId}-${t.name}`}
                  title={`Agent: ${t.agentName}`}
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: isRunning ? `${color}44` : `${color}15`,
                    color: isRunning ? "#fff" : color,
                    border: `1px solid ${isRunning ? color : color + "44"}`,
                    fontFamily: "monospace",
                    fontWeight: isRunning ? 700 : 400,
                    boxShadow: isRunning ? `0 0 8px ${color}60` : "none",
                    transition: "all 0.3s ease",
                  }}
                >
                  {isRunning ? "⏳ " : ""}{t.name}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Tool call history */}
      {toolCalls.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 8, fontWeight: 600 }}>
            CALL HISTORY ({toolCalls.length})
          </div>
          {toolCalls.map((call) => (
            <ToolCallRow
              key={call.call_id}
              call={call}
              color={getAgentColor(call.agent_id, agents)}
              isActive={call.call_id === activeToolCallId}
            />
          ))}
        </>
      )}
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  color: "#888",
  fontSize: 13,
  textAlign: "center",
};
