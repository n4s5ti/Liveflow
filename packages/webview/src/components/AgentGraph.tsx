import React, { useMemo, useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Node,
  Edge,
  Handle,
  Position,
  type NodeProps,
  type OnNodesChange,
  type OnEdgesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { useLiveflowStore } from "@/store";
import type { AgentInfo, AgentState, ToolCall } from "@/types";
import { AnimatedHandoffEdge } from "./AnimatedHandoffEdge";
import { ToolNode, type ToolNodeData } from "./ToolNode";

// ─── Constants ───────────────────────────────────────────────────────────────

const STATE_COLORS: Record<AgentState, string> = {
  initializing: "#888",
  idle: "#888",
  listening: "#22c55e",
  thinking: "#eab308",
  speaking: "#3b82f6",
};

const AGENT_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f97316", "#14b8a6", "#ef4444",
];

const AGENT_NODE_W = 240;
const AGENT_NODE_H = 160;
const TOOL_NODE_W = 150;
const TOOL_NODE_H = 50;

// ─── Agent Node ──────────────────────────────────────────────────────────────

interface AgentNodeData {
  agent: AgentInfo;
  isActive: boolean;
  agentState: AgentState;
  colorIndex: number;
  isHandoffTarget: boolean;
  sessionStarted: boolean;
  activeTool: string | null;
  toolStats: { total: number; errors: number };
  activeTimeMs: number;
  expanded: boolean;
  onToggleExpand: (agentId: string) => void;
  [key: string]: unknown;
}

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const {
    agent, isActive, agentState, colorIndex, isHandoffTarget,
    sessionStarted, activeTool, toolStats, activeTimeMs, expanded, onToggleExpand,
  } = data;

  const color = AGENT_COLORS[colorIndex % AGENT_COLORS.length];
  const stateColor = isActive ? STATE_COLORS[agentState] : "transparent";
  const dimmed = sessionStarted && !isActive;

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  return (
    <div
      style={{
        background: "var(--liveflow-editor-background, #1e1e1e)",
        border: `2px solid ${isActive ? color : dimmed ? "#333" : "#444"}`,
        borderRadius: 12,
        padding: "12px 16px",
        minWidth: 200,
        maxWidth: 280,
        opacity: dimmed ? 0.5 : 1,
        boxShadow: isActive
          ? `0 0 20px ${color}40, 0 0 40px ${color}20`
          : "0 2px 8px rgba(0,0,0,0.3)",
        transition: "all 0.4s ease",
        animation: isHandoffTarget ? "handoff-flash 0.6s ease" : undefined,
        position: "relative",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: color, width: 8, height: 8 }} />
      <Handle type="source" position={Position.Bottom} style={{ background: color, width: 8, height: 8 }} />

      {/* Header: name + state dot */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <div
          style={{
            width: 10, height: 10, borderRadius: "50%", background: stateColor, flexShrink: 0,
            animation: isActive && agentState === "thinking" ? "pulse 1s infinite" : undefined,
            boxShadow: isActive ? `0 0 6px ${stateColor}` : undefined,
          }}
        />
        <div
          style={{
            fontWeight: 600, fontSize: 14,
            color: "var(--liveflow-editor-foreground, #ccc)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
          }}
        >
          {agent.name}
        </div>
      </div>

      {/* ID */}
      <div style={{ fontSize: 10, color: "#666", marginBottom: 6, fontFamily: "monospace" }}>
        {agent.id}
      </div>

      {/* Instructions (truncated) */}
      {agent.instructions && (
        <div
          style={{
            fontSize: 11, color: "#999", marginBottom: 8, lineHeight: 1.3,
            display: "-webkit-box", WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical" as any, overflow: "hidden",
          }}
        >
          {agent.instructions}
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        {toolStats.total > 0 && (
          <span style={{ fontSize: 10, color: "#888" }}>
            🔧 {toolStats.total} call{toolStats.total !== 1 ? "s" : ""}
            {toolStats.errors > 0 && (
              <span style={{ color: "#ef4444", marginLeft: 4 }}>
                · ⚠ {toolStats.errors}
              </span>
            )}
          </span>
        )}
        {activeTimeMs > 0 && (
          <span style={{ fontSize: 10, color: "#888" }}>
            ⏱ {formatTime(activeTimeMs)}
          </span>
        )}
      </div>

      {/* Tool pills + expand toggle */}
      {agent.tools.length > 0 && (
        <div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {agent.tools.slice(0, expanded ? undefined : 3).map((tool) => {
              const isToolActive = isActive && activeTool === tool;
              return (
                <span
                  key={tool}
                  style={{
                    fontSize: 10, padding: "2px 6px", borderRadius: 4,
                    background: isToolActive ? `${color}44` : `${color}22`,
                    color: isToolActive ? "#fff" : color,
                    border: `1px solid ${isToolActive ? color : color + "44"}`,
                    fontFamily: "monospace", fontWeight: isToolActive ? 700 : 400,
                    boxShadow: isToolActive ? `0 0 8px ${color}60` : "none",
                    transition: "all 0.3s ease",
                  }}
                >
                  {isToolActive ? "⏳ " : ""}{tool}
                </span>
              );
            })}
          </div>
          {/* Expand/collapse toggle for tool sub-nodes */}
          {agent.tools.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(agent.id);
              }}
              style={{
                marginTop: 6, fontSize: 10, color: color, cursor: "pointer",
                background: `${color}11`, border: `1px solid ${color}33`,
                borderRadius: 4, padding: "2px 8px",
              }}
            >
              {expanded
                ? "▴ Collapse tools"
                : toolStats.total > 0
                  ? `▾ Expand ${toolStats.total} call${toolStats.total !== 1 ? "s" : ""}`
                  : `▾ Show ${agent.tools.length} tool${agent.tools.length !== 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      )}

      {/* Active state badge */}
      {isActive && (
        <div
          style={{
            position: "absolute", top: -8, right: -8, fontSize: 10,
            padding: "2px 8px", borderRadius: 10, background: color,
            color: "#fff", fontWeight: 600,
          }}
        >
          {agentState}
        </div>
      )}
    </div>
  );
}

// ─── User Node ───────────────────────────────────────────────────────────────

interface UserNodeData {
  userState: string;
  [key: string]: unknown;
}

function UserNode({ data }: NodeProps<Node<UserNodeData>>) {
  const userState = data.userState;
  const isActive = userState === "speaking";

  return (
    <div
      style={{
        background: "var(--liveflow-editor-background, #1e1e1e)",
        border: `2px solid ${isActive ? "#22c55e" : "#555"}`,
        borderRadius: "50%", width: 80, height: 80,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        boxShadow: isActive ? "0 0 20px #22c55e40" : "0 2px 8px rgba(0,0,0,0.3)",
        transition: "all 0.3s ease",
      }}
    >
      <Handle type="source" position={Position.Bottom} style={{ background: "#22c55e", width: 8, height: 8 }} />
      <div style={{ fontSize: 20 }}>🎤</div>
      <div style={{ fontSize: 10, color: "#999", marginTop: 2 }}>{userState}</div>
    </div>
  );
}

// ─── Dagre Layout ────────────────────────────────────────────────────────────

function computeLayout(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 120, nodesep: 80 });

  for (const node of nodes) {
    const w = node.type === "tool" ? TOOL_NODE_W : node.type === "user" ? 80 : AGENT_NODE_W;
    const h = node.type === "tool" ? TOOL_NODE_H : node.type === "user" ? 80 : AGENT_NODE_H;
    g.setNode(node.id, { width: w, height: h });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    const w = node.type === "tool" ? TOOL_NODE_W : node.type === "user" ? 80 : AGENT_NODE_W;
    const h = node.type === "tool" ? TOOL_NODE_H : node.type === "user" ? 80 : AGENT_NODE_H;
    return { ...node, position: { x: pos.x - w / 2, y: pos.y - h / 2 } };
  });
}

function topoSortAgents(agents: AgentInfo[], edges: { from_id: string; to_id: string }[]): AgentInfo[] {
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const a of agents) { inDeg.set(a.id, 0); adj.set(a.id, []); }
  for (const e of edges) {
    if (inDeg.has(e.to_id) && inDeg.has(e.from_id)) {
      inDeg.set(e.to_id, (inDeg.get(e.to_id) ?? 0) + 1);
      adj.get(e.from_id)!.push(e.to_id);
    }
  }
  const queue: AgentInfo[] = agents.filter((a) => (inDeg.get(a.id) ?? 0) === 0);
  const sorted: AgentInfo[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const nid of adj.get(node.id) ?? []) {
      const deg = (inDeg.get(nid) ?? 0) - 1;
      inDeg.set(nid, deg);
      if (deg === 0) { const n = agents.find((a) => a.id === nid); if (n) queue.push(n); }
    }
  }
  for (const a of agents) { if (!sorted.some((s) => s.id === a.id)) sorted.push(a); }
  return sorted;
}

// ─── Node / Edge types ───────────────────────────────────────────────────────

const nodeTypes = { agent: AgentNode, user: UserNode, tool: ToolNode };
const edgeTypes = { handoff: AnimatedHandoffEdge };

// ─── Main Component ──────────────────────────────────────────────────────────

export function AgentGraph() {
  const agents = useLiveflowStore((s) => s.agents);
  const scannedHandoffs = useLiveflowStore((s) => s.scannedHandoffs);
  const currentAgentId = useLiveflowStore((s) => s.currentAgentId);
  const initialAgentId = useLiveflowStore((s) => s.initialAgentId);
  const agentState = useLiveflowStore((s) => s.agentState);
  const userState = useLiveflowStore((s) => s.userState);
  const lastHandoff = useLiveflowStore((s) => s.lastHandoff);
  const sessionStarted = useLiveflowStore((s) => s.sessionStarted);
  const activeToolCallId = useLiveflowStore((s) => s.activeToolCallId);
  const toolCalls = useLiveflowStore((s) => s.toolCalls);
  const agentActiveTime = useLiveflowStore((s) => s.agentActiveTime);
  const agentActiveSince = useLiveflowStore((s) => s.agentActiveSince);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();

  // Track which agents have their tool sub-nodes expanded
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());

  // Track last structural key so we only re-layout on structural changes
  const lastStructuralKeyRef = useRef("");

  const toggleExpand = useCallback((agentId: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId); else next.add(agentId);
      return next;
    });
  }, []);

  // Currently-running tool name
  const activeTool = useMemo(() => {
    if (!activeToolCallId) return null;
    const tc = toolCalls.find((t) => t.call_id === activeToolCallId);
    return tc?.tool_name ?? null;
  }, [activeToolCallId, toolCalls]);

  // Per-agent tool stats
  const agentToolStats = useMemo(() => {
    const map: Record<string, { total: number; errors: number }> = {};
    for (const tc of toolCalls) {
      if (!map[tc.agent_id]) map[tc.agent_id] = { total: 0, errors: 0 };
      map[tc.agent_id].total++;
      if (tc.status === "error") map[tc.agent_id].errors++;
    }
    return map;
  }, [toolCalls]);

  // Compute real-time active time for current agent
  const getActiveTime = useCallback((agentId: string) => {
    const base = agentActiveTime[agentId] || 0;
    if (agentId === currentAgentId && agentActiveSince) {
      return base + (Date.now() - new Date(agentActiveSince).getTime());
    }
    return base;
  }, [agentActiveTime, currentAgentId, agentActiveSince]);

  // Stable sort order + color mapping
  const { sortedAgents, colorMap } = useMemo(() => {
    if (agents.length === 0) return { sortedAgents: [], colorMap: new Map<string, number>() };

    const edgesForSort = scannedHandoffs.length > 0
      ? scannedHandoffs
      : agents.flatMap((a) =>
          a.tools.map((t) => ({ from_id: a.id, to_id: t.replace(/^to_/, "") }))
            .filter((e) => agents.some((x) => x.id === e.to_id) && e.to_id !== a.id));

    const sorted = topoSortAgents(agents, edgesForSort);
    const cm = new Map<string, number>();
    sorted.forEach((a, i) => cm.set(a.id, i));
    return { sortedAgents: sorted, colorMap: cm };
  }, [agents, scannedHandoffs]);

  // ─── Build / update nodes + edges ───────────────────────────────────────

  useEffect(() => {
    if (sortedAgents.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const agentIds = new Set(sortedAgents.map((a) => a.id));

    // Structural key: ONLY agents + handoff edges — tool expand/collapse never re-runs dagre
    const structuralKey = [
      sortedAgents.map((a) => a.id).join(","),
      scannedHandoffs.map((h) => `${h.from_id}>${h.to_id}`).join(","),
      initialAgentId,
    ].join("|");

    const needsLayout = structuralKey !== lastStructuralKeyRef.current;

    // ─── Build node array ────────────────────────────────────────────────

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    const edgeKeys = new Set<string>();

    // User node
    newNodes.push({
      id: "user",
      type: "user",
      position: { x: 0, y: 0 },
      data: { userState },
    });

    // Agent nodes
    for (const agent of sortedAgents) {
      const ci = colorMap.get(agent.id) ?? 0;
      const isActive = agent.id === currentAgentId;
      const isExp = expandedAgents.has(agent.id);
      const stats = agentToolStats[agent.id] || { total: 0, errors: 0 };

      newNodes.push({
        id: agent.id,
        type: "agent",
        position: { x: 0, y: 0 },
        data: {
          agent,
          isActive,
          agentState: isActive ? agentState : "idle",
          colorIndex: ci,
          isHandoffTarget: lastHandoff?.new_agent_id === agent.id,
          sessionStarted,
          activeTool: isActive ? activeTool : null,
          toolStats: stats,
          activeTimeMs: getActiveTime(agent.id),
          expanded: isExp,
          onToggleExpand: toggleExpand,
        } as AgentNodeData,
      });

      // Tool sub-nodes when expanded — positions are computed AFTER agent layout, below
      if (isExp) {
        const agentToolCalls = toolCalls.filter((tc) => tc.agent_id === agent.id);
        const color = AGENT_COLORS[ci % AGENT_COLORS.length];

        // If no calls yet, show static capability nodes for each available tool
        if (agentToolCalls.length === 0) {
          for (const toolName of agent.tools) {
            const toolNodeId = `tool-cap-${agent.id}-${toolName}`;
            // position placeholder — will be overridden by fanout logic below
            newNodes.push({
              id: toolNodeId,
              type: "tool",
              position: { x: 0, y: 0 },
              data: {
                toolName,
                status: "capability" as any,
                durationMs: undefined,
                arguments: undefined,
                output: undefined,
                hasHandoff: false,
                color,
              } as ToolNodeData,
            });
            const ek = `${agent.id}-${toolNodeId}`;
            newEdges.push({
              id: ek,
              source: agent.id,
              target: toolNodeId,
              type: "handoff",
              data: { color: color + "44", label: undefined, animated: false },
            });
            edgeKeys.add(ek);
          }
        }

        for (const tc of agentToolCalls) {
          const toolNodeId = `tool-${tc.call_id}`;
          newNodes.push({
            id: toolNodeId,
            type: "tool",
            position: { x: 0, y: 0 },
            data: {
              toolName: tc.tool_name,
              status: tc.status,
              durationMs: tc.duration_ms,
              arguments: tc.arguments,
              output: tc.output,
              hasHandoff: tc.has_handoff,
              color,
            } as ToolNodeData,
          });
          // Edge: agent → tool
          const ek = `${agent.id}-${toolNodeId}`;
          newEdges.push({
            id: ek,
            source: agent.id,
            target: toolNodeId,
            type: "handoff",
            data: { color: color + "66", label: undefined, animated: tc.status === "running" },
          });
          edgeKeys.add(ek);

          // If this tool triggered a handoff, draw edge from tool → target agent
          if (tc.has_handoff) {
            // Find the matching handoff to get the target agent
            const matchingHandoff = useLiveflowStore.getState().handoffs.find(
              (h) => h.trigger_tool === tc.tool_name && h.old_agent_id === agent.id
            );
            if (matchingHandoff && agentIds.has(matchingHandoff.new_agent_id)) {
              const hek = `${toolNodeId}-${matchingHandoff.new_agent_id}`;
              if (!edgeKeys.has(hek)) {
                newEdges.push({
                  id: hek,
                  source: toolNodeId,
                  target: matchingHandoff.new_agent_id,
                  type: "handoff",
                  data: { color: "#22c55e88", label: "handoff", animated: false },
                });
                edgeKeys.add(hek);
              }
            }
          }
        }
      }
    }

    // ─── User → root edge ────────────────────────────────────────────────

    const rootId = initialAgentId || sortedAgents[0]?.id;
    if (rootId && agentIds.has(rootId)) {
      const ek = `user-${rootId}`;
      const ci = colorMap.get(rootId) ?? 0;
      const isRootActive = rootId === currentAgentId;
      newEdges.push({
        id: ek,
        source: "user",
        target: rootId,
        type: "handoff",
        data: {
          color: isRootActive ? AGENT_COLORS[ci % AGENT_COLORS.length] : "#444",
          animated: isRootActive,
          label: undefined,
        },
      });
      edgeKeys.add(ek);
    }

    // ─── Handoff edges ───────────────────────────────────────────────────

    const handoffEdgeList = scannedHandoffs.length > 0
      ? scannedHandoffs.filter((h) => agentIds.has(h.from_id) && agentIds.has(h.to_id) && h.from_id !== h.to_id)
          .map((h) => ({ from: h.from_id, to: h.to_id, tool: h.tool }))
      : sortedAgents.flatMap((agent) =>
          agent.tools
            .map((t) => ({ from: agent.id, to: t.replace(/^to_/, ""), tool: t }))
            .filter((e) => agentIds.has(e.to) && e.to !== agent.id)
        );

    for (const h of handoffEdgeList) {
      const ek = `${h.from}-${h.to}`;
      if (edgeKeys.has(ek)) continue;
      edgeKeys.add(ek);

      const ci = colorMap.get(h.from) ?? 0;
      const isLive =
        lastHandoff?.old_agent_id === h.from && lastHandoff?.new_agent_id === h.to;

      newEdges.push({
        id: ek,
        source: h.from,
        target: h.to,
        type: "handoff",
        data: {
          color: AGENT_COLORS[ci % AGENT_COLORS.length] + "88",
          animated: isLive,
          label: h.tool,
        },
      });
    }

    // ─── Apply layout or merge ───────────────────────────────────────────
    // Tool nodes are NEVER fed into dagre — they are fanned out manually
    // below their parent agent so expanding never shifts the rest of the graph.

    // Separate structural (user + agent) nodes from tool sub-nodes
    const structuralNodes = newNodes.filter((n) => n.type !== "tool");
    const toolNodes       = newNodes.filter((n) => n.type === "tool");

    // Build agentId → tool[] map so we can fan them below their parent
    const toolsByAgent = new Map<string, Node[]>();
    for (const tn of toolNodes) {
      // Edge id pattern: "<agentId>-<toolNodeId>"
      const parentEdge = newEdges.find((e) => e.target === tn.id);
      if (!parentEdge) continue;
      const pid = parentEdge.source;
      if (!toolsByAgent.has(pid)) toolsByAgent.set(pid, []);
      toolsByAgent.get(pid)!.push(tn);
    }

    /** Fan tool nodes horizontally below the given agent position */
    function applyToolFanout(
      items: Node[],
      parentPos: { x: number; y: number }
    ): Node[] {
      const gap = 10;
      const total = items.length * TOOL_NODE_W + (items.length - 1) * gap;
      const startX = parentPos.x + AGENT_NODE_W / 2 - total / 2;
      return items.map((tn, i) => ({
        ...tn,
        position: {
          x: startX + i * (TOOL_NODE_W + gap),
          y: parentPos.y + AGENT_NODE_H + 44,
        },
      }));
    }

    if (needsLayout) {
      lastStructuralKeyRef.current = structuralKey;
      // Dagre only sees structural nodes; tool edges are excluded from ranking
      const structuralEdges = newEdges.filter(
        (e) => !e.id.includes("tool-") && !e.source.includes("tool-") && !e.target.includes("tool-")
      );
      const layoutedStructural = computeLayout(structuralNodes, structuralEdges);

      // Fan tool nodes below their newly-layouted parents
      const posMap = new Map(layoutedStructural.map((n) => [n.id, n.position]));
      const layoutedTools: Node[] = [];
      for (const [pid, items] of toolsByAgent) {
        const parentPos = posMap.get(pid);
        if (!parentPos) continue;
        layoutedTools.push(...applyToolFanout(items, parentPos));
      }

      setNodes([...layoutedStructural, ...layoutedTools]);
      setEdges(newEdges);
      setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
    } else {
      // Data-only update: preserve user-dragged positions for structural nodes,
      // re-fan tool nodes based on their parent's current position.
      setNodes((prev) => {
        const prevMap = new Map(prev.map((n) => [n.id, n]));

        const updatedStructural = structuralNodes.map((updated) => {
          const existing = prevMap.get(updated.id);
          if (!existing) return updated; // new agent — position will be wrong but rare
          return { ...existing, data: updated.data };
        });

        // Fan tool nodes below their parent's CURRENT (possibly dragged) position
        const posMap = new Map(updatedStructural.map((n) => [n.id, n.position]));
        const updatedTools: Node[] = [];
        for (const [pid, items] of toolsByAgent) {
          const parentPos = posMap.get(pid);
          if (!parentPos) continue;
          // Preserve existing tool positions for nodes that already exist (live call updates)
          const fanned = applyToolFanout(items, parentPos);
          const result = fanned.map((tn) => {
            const existing = prevMap.get(tn.id);
            // Keep existing position for known tool nodes so dragging them also works
            return existing ? { ...tn, position: existing.position, data: tn.data } : tn;
          });
          updatedTools.push(...result);
        }

        return [...updatedStructural, ...updatedTools];
      });
      setEdges(newEdges);
    }
  }, [
    sortedAgents, colorMap, scannedHandoffs, initialAgentId, expandedAgents,
    currentAgentId, agentState, userState, lastHandoff, sessionStarted,
    activeTool, agentToolStats, toolCalls, getActiveTime, toggleExpand,
    setNodes, setEdges, fitView,
  ]);

  // ─── Reset Layout button ──────────────────────────────────────────────

  const handleResetLayout = useCallback(() => {
    lastStructuralKeyRef.current = ""; // Force re-layout
    // Trigger a re-render by toggling a ref — the effect will re-run
    setExpandedAgents((prev) => new Set(prev));
  }, []);

  // ─── Empty state ──────────────────────────────────────────────────────

  if (agents.length === 0) {
    return (
      <div
        style={{
          height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
          color: "#888", fontSize: 14,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
          <div>Waiting for agent code scan...</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Run your agent with Liveflow to see the graph</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", width: "100%", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={3}
        nodesDraggable
        nodesConnectable={false}
        defaultEdgeOptions={{ type: "handoff" }}
      >
        <Background color="#333" gap={20} />
        <Controls
          showInteractive={true}
          style={{ background: "#2a2a2a", borderColor: "#444" }}
        />
        <MiniMap
          nodeColor={(node) => {
            if (node.type === "user") return "#22c55e";
            if (node.type === "tool") return "#eab30866";
            const ci = (node.data as any)?.colorIndex ?? 0;
            return AGENT_COLORS[ci % AGENT_COLORS.length];
          }}
          maskColor="rgba(0,0,0,0.7)"
          style={{ background: "#1a1a1a", borderColor: "#333" }}
        />
      </ReactFlow>

      {/* Reset Layout button */}
      <button
        onClick={handleResetLayout}
        title="Reset to auto layout"
        style={{
          position: "absolute", bottom: 12, left: 12,
          background: "#252530", border: "1px solid #444", borderRadius: 6,
          padding: "5px 10px", color: "#aaa", fontSize: 10, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 4, zIndex: 10,
        }}
      >
        ↻ Reset Layout
      </button>
    </div>
  );
}
