from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


def _now() -> str:
    """ISO 8601 timestamp in UTC."""
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Enums matching LiveKit SDK state types
# ---------------------------------------------------------------------------

class AgentState(str, Enum):
    """Maps to livekit.agents.voice.events.AgentState"""
    INITIALIZING = "initializing"
    IDLE = "idle"
    LISTENING = "listening"
    THINKING = "thinking"
    SPEAKING = "speaking"


class UserState(str, Enum):
    """Maps to livekit.agents.voice.events.UserState"""
    SPEAKING = "speaking"
    LISTENING = "listening"
    AWAY = "away"


class ToolCallStatus(str, Enum):
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"


# ---------------------------------------------------------------------------
# Base message — every message has these fields
# ---------------------------------------------------------------------------

class BaseMessage(BaseModel):
    """
    Base for all WebSocket messages. 
    - `type`: discriminator string (e.g. "agent_state", "handoff")
    - `timestamp`: when this event occurred (ISO 8601)
    - `session_id`: LiveKit session identifier (links events to a conversation)
    """
    type: str
    timestamp: str = Field(default_factory=_now)
    session_id: str = ""


# ---------------------------------------------------------------------------
# Session lifecycle messages
# ---------------------------------------------------------------------------

class AgentInfo(BaseModel):
    """Describes a single agent in the user's code."""
    id: str                         # e.g. "greeting", "object_detection_agent"
    name: str                       # class name, e.g. "Greeting"
    instructions: str = ""          # the agent's system prompt (truncated)
    tools: list[str] = []           # names of @function_tool methods


class SessionInitMessage(BaseMessage):
    """
    Sent once when the dashboard first connects.
    Contains the full list of registered agents and which one is currently active.
    This lets the dashboard draw the initial agent graph.
    """
    type: Literal["session_init"] = "session_init"
    agents: list[AgentInfo] = []
    current_agent_id: str = ""
    agent_state: str = "initializing"
    user_state: str = "listening"


class SessionEndMessage(BaseMessage):
    """Sent when the agent session closes."""
    type: Literal["session_end"] = "session_end"
    reason: str = ""
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Agent state messages
# ---------------------------------------------------------------------------

class AgentStateMessage(BaseMessage):
    """
    Fired every time the agent's state changes.
    This is what drives the pulsing indicator on the active agent node:
    - listening (green) → thinking (yellow) → speaking (blue)
    """
    type: Literal["agent_state"] = "agent_state"
    old_state: str
    new_state: str
    agent_id: str = ""


class UserStateMessage(BaseMessage):
    """
    Fired when the user's microphone state changes.
    Drives the user state indicator in the dashboard.
    """
    type: Literal["user_state"] = "user_state"
    old_state: str
    new_state: str


# ---------------------------------------------------------------------------
# Transcript messages
# ---------------------------------------------------------------------------

class TranscriptMessage(BaseMessage):
    """
    User's speech-to-text result. 
    `is_final=False` means it's a partial/streaming transcript (grayed out in UI).
    `is_final=True` means the STT has finalized this utterance.
    """
    type: Literal["transcript"] = "transcript"
    speaker: Literal["user", "agent"] = "user"
    text: str = ""
    is_final: bool = True
    language: Optional[str] = None
    agent_id: Optional[str] = None  # which agent generated this (for agent speech)


class ConversationItemMessage(BaseMessage):
    """
    A new item was added to the conversation (chat context).
    This could be a user message, agent message, system message, 
    function call, or function call output.
    """
    type: Literal["conversation_item"] = "conversation_item"
    role: str = ""           # "user", "assistant", "system", "tool"
    content: str = ""        # text content (may be empty for function calls)
    item_type: str = ""      # "message", "function_call", "function_call_output", "agent_handoff"
    agent_id: str = ""       # which agent's context this belongs to
    metadata: dict[str, Any] = Field(default_factory=dict)  # extra data (tool name, call_id, etc.)


# ---------------------------------------------------------------------------
# Tool call messages
# ---------------------------------------------------------------------------

class ToolCallStartMessage(BaseMessage):
    """
    A function tool has started executing.
    Shown as a spinning indicator in the Tool Timeline.
    """
    type: Literal["tool_call_start"] = "tool_call_start"
    call_id: str             # unique ID to correlate start/end
    tool_name: str           # e.g. "update_object_to_find"
    arguments: str = ""      # JSON string of the arguments
    agent_id: str = ""       # which agent owns this tool


class ToolCallEndMessage(BaseMessage):
    """
    A function tool has finished executing.
    Updates the spinning indicator → checkmark (success) or X (error).
    """
    type: Literal["tool_call_end"] = "tool_call_end"
    call_id: str
    tool_name: str
    output: str = ""
    is_error: bool = False
    duration_ms: float = 0.0
    agent_id: str = ""
    has_handoff: bool = False  # True if this tool triggered an agent transfer


# ---------------------------------------------------------------------------
# Agent handoff messages
# ---------------------------------------------------------------------------

class HandoffMessage(BaseMessage):
    """
    An agent transfer/handoff occurred.
    This is the key event that animates the agent graph —
    the highlight moves from old_agent → new_agent, and the connecting edge flashes.
    """
    type: Literal["handoff"] = "handoff"
    old_agent_id: str
    new_agent_id: str
    old_agent_name: str = ""
    new_agent_name: str = ""
    trigger_tool: str = ""   # which tool call triggered this handoff


# ---------------------------------------------------------------------------
# Speech messages  
# ---------------------------------------------------------------------------

class SpeechCreatedMessage(BaseMessage):
    """The agent started generating a new speech response."""
    type: Literal["speech_created"] = "speech_created"
    user_initiated: bool = False
    source: str = ""  # "say" or "generate_reply"
    agent_id: str = ""


# ---------------------------------------------------------------------------
# Metrics messages
# ---------------------------------------------------------------------------

class MetricsMessage(BaseMessage):
    """
    Pipeline performance metrics (LLM latency, STT latency, TTS latency, etc.).
    Displayed in a metrics panel or tooltip.
    """
    type: Literal["metrics"] = "metrics"
    metrics: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Error messages
# ---------------------------------------------------------------------------

class ErrorMessage(BaseMessage):
    """An error occurred in the agent pipeline."""
    type: Literal["error"] = "error"
    error_type: str = ""     # "LLMError", "STTError", "TTSError", etc.
    message: str = ""
    source: str = ""


# ---------------------------------------------------------------------------
# Chat context snapshot
# ---------------------------------------------------------------------------

class ChatContextItem(BaseModel):
    """A single item in the chat context."""
    item_type: str = ""       # "message", "function_call", "function_call_output", "agent_handoff"
    role: str = ""            # "system", "user", "assistant", "tool"
    content: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChatContextSnapshotMessage(BaseMessage):
    """
    Full snapshot of the conversation's chat context.
    Sent after each conversation_item_added event so the Chat Inspector stays in sync.
    """
    type: Literal["chat_ctx_snapshot"] = "chat_ctx_snapshot"
    items: list[ChatContextItem] = []
    agent_id: str = ""


# ---------------------------------------------------------------------------
# Connection / heartbeat
# ---------------------------------------------------------------------------

class PingMessage(BaseMessage):
    """Heartbeat to keep the WebSocket alive."""
    type: Literal["ping"] = "ping"


class PongMessage(BaseMessage):
    """Heartbeat response."""
    type: Literal["pong"] = "pong"


# ---------------------------------------------------------------------------
# Code scan messages — sent before session starts
# ---------------------------------------------------------------------------

class ScannedHandoff(BaseModel):
    """A handoff edge discovered by static code analysis."""
    from_id: str
    to_id: str
    tool: str = ""  # tool that triggers this handoff (if known)


class CodeScanMessage(BaseMessage):
    """
    Sent once before the agent session starts, containing ALL agents and tools
    discovered by static AST analysis of the user's agent code.

    This lets the dashboard show the full agent graph immediately,
    before any runtime events arrive.
    """
    type: Literal["code_scan"] = "code_scan"
    agents: list[AgentInfo] = []
    handoffs: list[ScannedHandoff] = []


# ---------------------------------------------------------------------------
# Union of all message types (for type-safe deserialization)
# ---------------------------------------------------------------------------

LiveflowMessage = (
    SessionInitMessage
    | SessionEndMessage
    | AgentStateMessage
    | UserStateMessage
    | TranscriptMessage
    | ConversationItemMessage
    | ToolCallStartMessage
    | ToolCallEndMessage
    | HandoffMessage
    | SpeechCreatedMessage
    | MetricsMessage
    | ErrorMessage
    | ChatContextSnapshotMessage
    | CodeScanMessage
    | PingMessage
    | PongMessage
)
