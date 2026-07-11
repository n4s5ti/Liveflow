import { create } from "zustand";
import type {
  AgentInfo,
  AgentState,
  UserState,
  ToolCall,
  TranscriptEntry,
  Handoff,
  ScannedHandoff,
  ChatContextItem,
  LiveflowMessage,
} from "../types";

interface LiveflowState {
  // ---- Connection ----
  connected: boolean;
  sessionId: string;
  sessionStartTime: string | null;

  // ---- Agents ----
  agents: AgentInfo[]; // All registered agents (from code scan + runtime)
  scannedHandoffs: ScannedHandoff[]; // Pre-scanned handoff edges
  currentAgentId: string; // Which agent is currently active
  initialAgentId: string; // First agent that started the session (entry point)
  agentState: AgentState; // Current agent's state (listening/thinking/speaking)
  userState: UserState; // User's mic state (speaking/listening/away)
  sessionStarted: boolean; // True once session_init is received

  // ---- Tool Calls ----
  toolCalls: ToolCall[]; // Ordered list of all tool calls
  activeToolCallId: string | null; // Currently-running tool call ID (for highlighting)

  // ---- Transcript ----
  transcripts: TranscriptEntry[]; // User + agent messages in order

  // ---- Handoffs ----
  handoffs: Handoff[]; // Agent transfer history
  lastHandoff: Handoff | null; // Most recent handoff (for animation)

  // ---- Chat Context ----
  chatContext: ChatContextItem[]; // Full chat_ctx snapshot

  // ---- Stats ----
  agentActiveTime: Record<string, number>; // cumulative ms each agent was active
  agentActiveSince: string | null; // ISO timestamp when currentAgent became active

  // ---- Errors ----
  errors: Array<{ type: string; message: string; timestamp: string }>;

  // ---- Actions ----
  handleMessage: (msg: LiveflowMessage) => void;
  setConnected: (connected: boolean) => void;
  reset: () => void;
}

const initialState = {
  connected: false,
  sessionId: "",
  sessionStartTime: null as string | null,
  agents: [] as AgentInfo[],
  scannedHandoffs: [] as ScannedHandoff[],
  currentAgentId: "",
  initialAgentId: "",
  agentState: "initializing" as AgentState,
  userState: "listening" as UserState,
  sessionStarted: false,
  toolCalls: [] as ToolCall[],
  activeToolCallId: null as string | null,
  transcripts: [] as TranscriptEntry[],
  handoffs: [] as Handoff[],
  lastHandoff: null as Handoff | null,
  chatContext: [] as ChatContextItem[],
  agentActiveTime: {} as Record<string, number>,
  agentActiveSince: null as string | null,
  errors: [] as Array<{ type: string; message: string; timestamp: string }>,
};

export const useLiveflowStore = create<LiveflowState>((set, get) => ({
  ...initialState,

  setConnected: (connected: boolean) => set({ connected }),

  reset: () => set(initialState),

  handleMessage: (msg: LiveflowMessage) => {
    console.log(`[Liveflow Store] msg: ${msg.type}`, JSON.stringify(msg).slice(0, 300));
    switch (msg.type) {
      // ---- Code scan (pre-session, static analysis) ----
      // Arrives before session_init with ALL agents discovered from code.
      case "code_scan": {
        const m = msg as any;
        const scannedAgents: AgentInfo[] = m.agents || [];
        const scannedHandoffs: ScannedHandoff[] = m.handoffs || [];
        console.log(`[Liveflow Store] code_scan: agents=[${scannedAgents.map((a: any) => a.id).join(", ")}] handoffs=${scannedHandoffs.length}`);
        set({
          agents: scannedAgents,
          scannedHandoffs,
        });
        break;
      }

      case "session_init": {
        const m = msg as any;
        const runtimeAgents: AgentInfo[] = m.agents || [];
        const existingAgents = get().agents;
        console.log(`[Liveflow Store] session_init: runtimeAgents=[${runtimeAgents.map((a: any) => a.id).join(", ")}] existingAgents=[${existingAgents.map((a: any) => a.id).join(", ")}] current_agent_id=${m.current_agent_id}`);
        
        // Merge: update any existing agent data with runtime info (which has 
        // more accurate tool lists), and add any new agents not in the scan.
        const merged = [...existingAgents];
        for (const ra of runtimeAgents) {
          const idx = merged.findIndex((a) => a.id === ra.id || a.name === ra.name);
          if (idx >= 0) {
            // Update with runtime data (may have more tools info)
            merged[idx] = { ...merged[idx], ...ra };
          } else {
            merged.push(ra);
          }
        }
        console.log(`[Liveflow Store] session_init merged: [${merged.map((a: any) => a.id).join(", ")}]`);
        
        const incomingCurrentId = m.current_agent_id || "";
        set((state) => ({
          sessionId: msg.session_id,
          sessionStartTime: msg.timestamp,
          agents: merged,
          currentAgentId: incomingCurrentId,
          initialAgentId: state.initialAgentId || incomingCurrentId,
          agentState: (m.agent_state || "initializing") as AgentState,
          userState: (m.user_state || "listening") as UserState,
          sessionStarted: true,
          agentActiveSince: msg.timestamp,
        }));
        break;
      }

      // ---- Agent state change ----
      // e.g., listening → thinking → speaking
      case "agent_state": {
        const m = msg as any;
        const newAgentId = m.agent_id as string | undefined;
        const existingAgents = get().agents;
        const agentExists = newAgentId && existingAgents.some((a) => a.id === newAgentId);
        console.log(`[Liveflow Store] agent_state: agent_id=${newAgentId} new_state=${m.new_state} agentExists=${agentExists} knownAgents=[${existingAgents.map((a: any) => a.id).join(", ")}]`);
        // Upsert the agent so it's visible in the graph even without a code_scan
        const updatedAgents =
          newAgentId && !agentExists
            ? [...existingAgents, { id: newAgentId, name: newAgentId, instructions: "", tools: [] } as AgentInfo]
            : existingAgents;
        // Accumulate time for the previously-active agent
        const prevId = get().currentAgentId;
        const since = get().agentActiveSince;
        const elapsed = since ? Date.now() - new Date(since).getTime() : 0;
        const activeTime = { ...get().agentActiveTime };
        if (prevId && elapsed > 0) {
          activeTime[prevId] = (activeTime[prevId] || 0) + elapsed;
        }

        const resolvedAgentId = newAgentId || prevId;
        set({
          agents: updatedAgents,
          agentState: m.new_state as AgentState,
          currentAgentId: resolvedAgentId,
          agentActiveTime: activeTime,
          agentActiveSince: resolvedAgentId !== prevId ? m.timestamp : since,
        });
        break;
      }

      // ---- User state change ----
      // e.g., listening → speaking
      case "user_state":
        set({ userState: (msg as any).new_state as UserState });
        break;

      // ---- User/agent transcript ----
      case "transcript": {
        const m = msg as any;
        const entry: TranscriptEntry = {
          id: `${m.timestamp}-${m.speaker}-${Math.random().toString(36).slice(2, 8)}`,
          speaker: m.speaker,
          text: m.text,
          is_final: m.is_final,
          timestamp: m.timestamp,
          agent_id: m.agent_id,
          language: m.language,
        };

        set((state) => {
          // If this is a final transcript, replace any non-final from same speaker
          if (entry.is_final) {
            const filtered = state.transcripts.filter(
              (t) => t.is_final || t.speaker !== entry.speaker
            );
            return { transcripts: [...filtered, entry] };
          }

          // Non-final: replace previous non-final from same speaker
          const filtered = state.transcripts.filter(
            (t) => t.is_final || t.speaker !== entry.speaker
          );
          return { transcripts: [...filtered, entry] };
        });
        break;
      }

      // ---- Tool call started ----
      case "tool_call_start": {
        const m = msg as any;
        console.log(`[Liveflow Store] tool_call_start: ${m.tool_name} agent_id=${m.agent_id} call_id=${m.call_id}`);
        const call: ToolCall = {
          call_id: m.call_id,
          tool_name: m.tool_name,
          arguments: m.arguments || "",
          output: "",
          status: "running",
          duration_ms: 0,
          agent_id: m.agent_id || "",
          has_handoff: false,
          timestamp: m.timestamp,
        };
        set((state) => ({
          toolCalls: [...state.toolCalls, call],
          activeToolCallId: m.call_id,
        }));
        break;
      }

      // ---- Tool call completed ----
      case "tool_call_end": {
        const m = msg as any;
        set((state) => ({
          toolCalls: state.toolCalls.map((tc) =>
            tc.call_id === m.call_id
              ? {
                  ...tc,
                  output: m.output || "",
                  status: m.is_error ? ("error" as const) : ("success" as const),
                  duration_ms: m.duration_ms || 0,
                  has_handoff: m.has_handoff || false,
                }
              : tc
          ),
          activeToolCallId:
            state.activeToolCallId === m.call_id ? null : state.activeToolCallId,
        }));
        break;
      }

      // ---- Agent handoff ----
      case "handoff": {
        const m = msg as any;
        const handoff: Handoff = {
          old_agent_id: m.old_agent_id,
          new_agent_id: m.new_agent_id,
          old_agent_name: m.old_agent_name,
          new_agent_name: m.new_agent_name,
          trigger_tool: m.trigger_tool || "",
          timestamp: m.timestamp,
        };
        console.log(`[Liveflow Store] handoff: ${m.old_agent_id} → ${m.new_agent_id} agents=[${get().agents.map((a: any) => a.id).join(", ")}]`);
        set((state) => {
          // Upsert both old and new agent into agents[] so the graph always
          // shows every agent that has actually appeared at runtime.
          let agents = state.agents;
          const upsert = (id: string, name: string) => {
            if (id && !agents.some((a) => a.id === id)) {
              agents = [...agents, { id, name: name || id, instructions: "", tools: [] } as AgentInfo];
            }
          };
          upsert(m.old_agent_id, m.old_agent_name);
          upsert(m.new_agent_id, m.new_agent_name);

          // Accumulate active time for the old agent
          const since = state.agentActiveSince;
          const elapsed = since ? Date.now() - new Date(since).getTime() : 0;
          const activeTime = { ...state.agentActiveTime };
          if (m.old_agent_id && elapsed > 0) {
            activeTime[m.old_agent_id] = (activeTime[m.old_agent_id] || 0) + elapsed;
          }

          return {
            agents,
            handoffs: [...state.handoffs, handoff],
            lastHandoff: handoff,
            currentAgentId: m.new_agent_id,
            agentActiveTime: activeTime,
            agentActiveSince: m.timestamp,
          };
        });

        // Clear the lastHandoff animation trigger after 2 seconds
        setTimeout(() => {
          set((state) => {
            if (state.lastHandoff === handoff) {
              return { lastHandoff: null };
            }
            return {};
          });
        }, 2000);
        break;
      }

      // ---- Chat context snapshot ----
      case "chat_ctx_snapshot": {
        const m = msg as any;
        set({ chatContext: m.items || [] });
        break;
      }

      // ---- Error ----
      case "error": {
        const m = msg as any;
        set((state) => ({
          errors: [
            ...state.errors,
            {
              type: m.error_type || "Unknown",
              message: m.message || "",
              timestamp: m.timestamp,
            },
          ],
        }));
        break;
      }

      // ---- Session end ----
      case "session_end":
        // "connected" represents session liveness (agent pipeline active),
        // not transport liveness. The browser WebSocket may remain open
        // after session_end; transport liveness is managed separately by
        // useWebSocketTransport.
        set({ connected: false });
        break;

      default:
        // Unknown message type — ignore silently
        break;
    }
  },
}));
