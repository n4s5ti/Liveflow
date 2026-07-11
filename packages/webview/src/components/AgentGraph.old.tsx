import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Node,
  Edge,
  Handle,
  Position,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { useLiveflowStore } from "@/store";
import type { AgentInfo, AgentState } from "@/types";

const STATE_COLORS: Record<AgentState, string> = {
  initializing: "#888",
  idle: "#888",
  listening: "#22c55e", // green
  thinking: "#eab308", // yellow
  speaking: "#3b82f6", // blue
};

// Agent node colors (cycled)
const AGENT_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#f97316", // orange
  "#14b8a6", // teal
  "#ef4444", // red
];

interface AgentNodeData {
  agent: AgentInfo;
  isActive: boolean;
  agentState: AgentState;
  colorIndex: number;
  isHandoffTarget: boolean;
  sessionStarted: boolean;
  activeTool: string | null;
  [key: string]: unknown;
}

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const { agent, isActive, agentState, colorIndex, isHandoffTarget, sessionStarted, activeTool } = data;
  const color = AGENT_COLORS[colorIndex % AGENT_COLORS.length];
  const stateColor = isActive ? STATE_COLORS[agentState] : "transparent";

  // Dim non-active agents once the session starts
  const dimmed = sessionStarted && !isActive;

  return (
    <div
      style={{
        background: "var(--liveflow-editor-background, #1e1e1e)",
        border: `2px solid ${isActive ? color : dimmed ? "#333" : "#444"}`,
        borderRadius: 12,
        padding: "12px 16px",
        minWidth: 180,
        maxWidth: 260,
        opacity: dimmed ? 0.5 : 1,
        boxShadow: isActive
          ? `0 0 20px ${color}40, 0 0 40px ${color}20`
          : "0 2px 8px rgba(0,0,0,0.3)",
        transition: "all 0.4s ease",
        animation: isHandoffTarget ? "handoff-flash 0.6s ease" : undefined,
        position: "relative",
      }}
    >
      {/* Connection handles */}
      <Handle type="target" position={Position.Top} style={{ background: color, width: 8, height: 8 }} />
      <Handle type="source" position={Position.Bottom} style={{ background: color, width: 8, height: 8 }} />

      {/* Header: name + state dot */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        {/* State indicator dot */}
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: stateColor,
            flexShrink: 0,
            animation: isActive && agentState === "thinking" ? "pulse 1s infinite" : undefined,
            boxShadow: isActive ? `0 0 6px ${stateColor}` : undefined,
          }}
        />
        <div
          style={{
            fontWeight: 600,
            fontSize: 14,
            color: "var(--liveflow-editor-foreground, #ccc)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {agent.name}
        </div>
      </div>

      {/* ID badge */}
      <div
        style={{
          fontSize: 10,
          color: "#888",
          marginBottom: 6,
          fontFamily: "monospace",
        }}
      >
        {agent.id}
      </div>

      {/* Instructions (truncated) */}
      {agent.instructions && (
        <div
          style={{
            fontSize: 11,
            color: "#999",
            marginBottom: 8,
            lineHeight: 1.3,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical" as any,
            overflow: "hidden",
          }}
        >
          {agent.instructions}
        </div>
      )}

      {/* Tools list */}
      {agent.tools.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {agent.tools.map((tool) => {
            const isToolActive = isActive && activeTool === tool;
            return (
              <span
                key={tool}
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: isToolActive ? `${color}44` : `${color}22`,
                  color: isToolActive ? "#fff" : color,
                  border: `1px solid ${isToolActive ? color : color + "44"}`,
                  fontFamily: "monospace",
                  fontWeight: isToolActive ? 700 : 400,
                  boxShadow: isToolActive ? `0 0 8px ${color}60` : "none",
                  transition: "all 0.3s ease",
                }}
              >
                {isToolActive ? "⏳ " : ""}{tool}
              </span>
            );
          })}
        </div>
      )}

      {/* Active state badge */}
      {isActive && (
        <div
          style={{
            position: "absolute",
            top: -8,
            right: -8,
            fontSize: 10,
            padding: "2px 8px",
            borderRadius: 10,
            background: color,
            color: "#fff",
            fontWeight: 600,
          }}
        >
          {agentState}
        </div>
      )}
    </div>
  );
}

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
        borderRadius: "50%",
        width: 80,
        height: 80,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: isActive ? "0 0 20px #22c55e40" : "0 2px 8px rgba(0,0,0,0.3)",
        transition: "all 0.3s ease",
      }}
    >
      <Handle type="source" position={Position.Bottom} style={{ background: "#22c55e", width: 8, height: 8 }} />
      <div style={{ fontSize: 20 }}>🎤</div>
      <div style={{ fontSize: 10, color: "#999", marginTop: 2 }}>
        {userState}
      </div>
    </div>
  );
}

function getLayoutedElements(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 80, nodesep: 60 });

  for (const node of nodes) {
    g.setNode(node.id, { width: 220, height: 140 });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: { x: pos.x - 110, y: pos.y - 70 },
    };
  });

  return { nodes: layoutedNodes, edges };
}

function topoSortAgents(
  agents: AgentInfo[],
  edges: { from_id: string; to_id: string }[]
): AgentInfo[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const a of agents) {
    inDegree.set(a.id, 0);
    adj.set(a.id, []);
  }
  for (const e of edges) {
    if (inDegree.has(e.to_id) && inDegree.has(e.from_id)) {
      inDegree.set(e.to_id, (inDegree.get(e.to_id) ?? 0) + 1);
      adj.get(e.from_id)!.push(e.to_id);
    }
  }

  // Kahn's algorithm
  const queue: AgentInfo[] = agents.filter((a) => (inDegree.get(a.id) ?? 0) === 0);
  const sorted: AgentInfo[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const neighbourId of adj.get(node.id) ?? []) {
      const deg = (inDegree.get(neighbourId) ?? 0) - 1;
      inDegree.set(neighbourId, deg);
      if (deg === 0) {
        const neighbour = agents.find((a) => a.id === neighbourId);
        if (neighbour) queue.push(neighbour);
      }
    }
  }
  // Append any nodes that weren't reached (cycles / isolated)
  for (const a of agents) {
    if (!sorted.some((s) => s.id === a.id)) sorted.push(a);
  }
  return sorted;
}

const nodeTypes = {
  agent: AgentNode,
  user: UserNode,
};

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

  // Find the currently-running tool name (for highlighting in agent node)
  const activeTool = useMemo(() => {
    if (!activeToolCallId) return null;
    const tc = toolCalls.find((t) => t.call_id === activeToolCallId);
    return tc?.tool_name ?? null;
  }, [activeToolCallId, toolCalls]);

  const agentKey = agents.map((a) => a.id).sort().join(",");
  const handoffKey = scannedHandoffs.map((h) => `${h.from_id}>${h.to_id}`).join(",");
  const rootKey = initialAgentId;

  const layout = useMemo(() => {
    if (agents.length === 0) return null;

    // Sort agents in call-flow (topological) order so dagre ranks them correctly
    const edgesForSort = scannedHandoffs.length > 0
      ? scannedHandoffs
      : agents.flatMap((a) =>
          a.tools
            .map((t) => ({ from_id: a.id, to_id: t.replace(/^to_/, "") }))
            .filter((e) => agents.some((x) => x.id === e.to_id) && e.to_id !== a.id)
        );
    const sortedAgents = topoSortAgents(agents, edgesForSort);

    const rawNodes: Node[] = [];
    const rawEdges: Edge[] = [];

    rawNodes.push({
      id: "user",
      type: "user",
      position: { x: 0, y: 0 },
      data: { userState: "listening" }, // placeholder — overwritten in memo 2
    });

    sortedAgents.forEach((agent, i) => {
      rawNodes.push({
        id: agent.id,
        type: "agent",
        position: { x: 0, y: 0 },
        data: { agent, isActive: false, agentState: "initializing", colorIndex: i,
                isHandoffTarget: false, sessionStarted: false, activeTool: null } as AgentNodeData,
      });
    });

    const agentIds = new Set(agents.map((a) => a.id));
    const edgeKeys = new Set<string>();

    // Anchor user node → entry agent so dagre ranks the entry agent correctly
    const rootId = initialAgentId || sortedAgents[0]?.id;
    if (rootId && agentIds.has(rootId)) {
      rawEdges.push({ id: `user-${rootId}`, source: "user", target: rootId });
      edgeKeys.add(`user-${rootId}`);
    }

    // Handoff edges for layout (styling applied in memo 2)
    if (scannedHandoffs.length > 0) {
      for (const h of scannedHandoffs) {
        if (agentIds.has(h.from_id) && agentIds.has(h.to_id) && h.from_id !== h.to_id) {
          const key = `${h.from_id}-${h.to_id}`;
          if (edgeKeys.has(key)) continue;
          edgeKeys.add(key);
          rawEdges.push({ id: key, source: h.from_id, target: h.to_id,
                          label: h.tool || undefined, data: { tool: h.tool } });
        }
      }
    } else {
      // Fallback: infer from tool names
      sortedAgents.forEach((agent) => {
        for (const tool of agent.tools) {
          const targetId = tool.replace(/^to_/, "");
          if (agentIds.has(targetId) && targetId !== agent.id) {
            const key = `${agent.id}-${targetId}`;
            if (edgeKeys.has(key)) continue;
            edgeKeys.add(key);
            rawEdges.push({ id: key, source: agent.id, target: targetId,
                            label: tool, data: { tool } });
          }
        }
      });
    }

    return getLayoutedElements(rawNodes, rawEdges);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentKey, handoffKey, rootKey]);

  const { nodes, edges } = useMemo(() => {
    if (!layout) return { nodes: [], edges: [] };

    const agentIds = new Set(agents.map((a) => a.id));

    const nodes = layout.nodes.map((node) => {
      if (node.id === "user") {
        return { ...node, data: { userState } };
      }
      const agent = agents.find((a) => a.id === node.id);
      if (!agent) return node;
      // Preserve colorIndex from Memo 1 (topological order) so colors are stable
      const colorIndex = (node.data as AgentNodeData).colorIndex;
      const isActive = agent.id === currentAgentId;
      const isHandoffTarget = lastHandoff?.new_agent_id === agent.id;
      return {
        ...node,
        data: {
          agent,
          isActive,
          agentState,
          colorIndex,
          isHandoffTarget,
          sessionStarted,
          activeTool: isActive ? activeTool : null,
        } as AgentNodeData,
      };
    });

    // Build a colorIndex lookup from the stable layout
    const colorIndexMap = new Map<string, number>();
    for (const n of layout.nodes) {
      if (n.id !== "user") colorIndexMap.set(n.id, (n.data as AgentNodeData).colorIndex);
    }

    // User→active-agent edge (add/replace without touching layout positions)
    const userEdges: Edge[] = agents
      .map((agent) => {
        const isActive = agent.id === currentAgentId;
        if (!isActive && sessionStarted) return null;
        const ci = colorIndexMap.get(agent.id) ?? 0;
        return {
          id: `user-${agent.id}`,
          source: "user",
          target: agent.id,
          style: {
            stroke: isActive ? AGENT_COLORS[ci % AGENT_COLORS.length] : "#444",
            strokeWidth: isActive ? 2 : 1,
          },
          animated: isActive,
        } as Edge;
      })
      .filter(Boolean) as Edge[];

    const handoffEdges: Edge[] = layout.edges.map((edge) => {
      const fromColorIdx = colorIndexMap.get(edge.source) ?? 0;
      const isHandoffEdge =
        lastHandoff?.old_agent_id === edge.source &&
        lastHandoff?.new_agent_id === edge.target;
      return {
        ...edge,
        labelStyle: { fontSize: 9, fill: "#888" },
        style: {
          stroke: isHandoffEdge
            ? "#22c55e"
            : AGENT_COLORS[(fromColorIdx >= 0 ? fromColorIdx : 0) % AGENT_COLORS.length] + "88",
          strokeWidth: isHandoffEdge ? 3 : 1,
          strokeDasharray: isHandoffEdge ? undefined : "5,5",
        },
        animated: isHandoffEdge,
      };
    });

    // Also handle runtime-discovered edges (from handoff history, no scanned data)
    if (scannedHandoffs.length === 0) {
      const edgeKeys = new Set(handoffEdges.map((e) => e.id));
      agents.forEach((agent, i) => {
        for (const tool of agent.tools) {
          const targetId = tool.replace(/^to_/, "");
          if (agentIds.has(targetId) && targetId !== agent.id) {
            const key = `${agent.id}-${targetId}`;
            if (edgeKeys.has(key)) continue;
            edgeKeys.add(key);
            const isHandoffEdge =
              lastHandoff?.old_agent_id === agent.id &&
              lastHandoff?.new_agent_id === targetId;
            handoffEdges.push({
              id: key, source: agent.id, target: targetId, label: tool,
              labelStyle: { fontSize: 9, fill: "#888" },
              style: {
                stroke: isHandoffEdge ? "#22c55e" : AGENT_COLORS[i % AGENT_COLORS.length] + "88",
                strokeWidth: isHandoffEdge ? 3 : 1,
                strokeDasharray: isHandoffEdge ? undefined : "5,5",
              },
              animated: isHandoffEdge,
            });
          }
        }
      });
    }

    return { nodes, edges: [...userEdges, ...handoffEdges] };
  }, [layout, agents, currentAgentId, agentState, userState, lastHandoff, sessionStarted, activeTool, scannedHandoffs]);

  // Waiting state — no agents discovered yet
  if (agents.length === 0) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#888",
          fontSize: 14,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
          <div>Waiting for agent code scan...</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            Run your agent with Liveflow to see the graph
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={2}
      >
        <Background color="#333" gap={20} />
        <Controls
          showInteractive={false}
          style={{ background: "#2a2a2a", borderColor: "#444" }}
        />
      </ReactFlow>
    </div>
  );
}
