import React from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

export interface ToolNodeData {
  toolName: string;
  status: "running" | "success" | "error" | "capability";
  durationMs: number | undefined;
  arguments: string | undefined;
  output: string | undefined;
  hasHandoff: boolean;
  color: string; // agent's color
  [key: string]: unknown;
}

export function ToolNode({ data }: NodeProps<Node<ToolNodeData>>) {
  const { toolName, status, durationMs, hasHandoff, color } = data;

  const statusConfig = {
    running:    { icon: "⏳", border: color,      bg: `${color}22`,    glow: `0 0 12px ${color}40` },
    success:    { icon: "✓",  border: "#22c55e",  bg: "#22c55e11",     glow: "none" },
    error:      { icon: "✗",  border: "#ef4444",  bg: "#ef444411",     glow: "0 0 8px #ef444430" },
    capability: { icon: "◦",  border: `${color}44`, bg: `${color}0a`, glow: "none" },
  }[status] ?? { icon: "◦", border: "#555", bg: "#1a1a1a", glow: "none" };

  return (
    <div
      style={{
        background: statusConfig.bg,
        border: `1.5px solid ${statusConfig.border}`,
        borderRadius: 8,
        padding: "6px 10px",
        minWidth: 120,
        maxWidth: 180,
        boxShadow: statusConfig.glow,
        transition: "all 0.3s ease",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: color, width: 6, height: 6, opacity: 0.6 }}
      />
      {hasHandoff && (
        <Handle
          type="source"
          position={Position.Bottom}
          style={{ background: "#22c55e", width: 6, height: 6 }}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span
          style={{
            fontSize: 11,
            animation: status === "running" ? "spin 1s linear infinite" : undefined,
            display: "inline-block",
          }}
        >
          {statusConfig.icon}
        </span>
        <span
          style={{
            fontSize: 11,
            fontFamily: "monospace",
            fontWeight: 600,
            color: "var(--liveflow-editor-foreground, #ccc)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {toolName}
        </span>
      </div>

      {/* Duration / status label */}
      <div
        style={{
          fontSize: 9,
          color: "#888",
          marginTop: 2,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {status === "running" ? (
          <span style={{ color: color }}>running…</span>
        ) : status === "capability" ? (
          <span style={{ color: `${color}88` }}>available</span>
        ) : (
          <span>{durationMs && durationMs > 0 ? `${durationMs.toFixed(0)}ms` : ""}</span>
        )}
        {hasHandoff && (
          <span
            style={{
              fontSize: 8,
              padding: "1px 4px",
              borderRadius: 3,
              background: "#22c55e22",
              color: "#22c55e",
              marginLeft: "auto",
            }}
          >
            handoff
          </span>
        )}
      </div>
    </div>
  );
}
