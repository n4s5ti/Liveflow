from __future__ import annotations

import json
import logging
import time
from typing import Any, Callable, Dict, List, Optional, Set

from .protocol import (
    AgentInfo,
    AgentStateMessage,
    ChatContextItem,
    ChatContextSnapshotMessage,
    ConversationItemMessage,
    ErrorMessage,
    HandoffMessage,
    MetricsMessage,
    SessionEndMessage,
    SessionInitMessage,
    SpeechCreatedMessage,
    ToolCallEndMessage,
    ToolCallStartMessage,
    TranscriptMessage,
    UserStateMessage,
)
from .ws_server import get_server
from .forwarder import get_forwarder

logger = logging.getLogger("liveflow.interceptor")


def _get_broadcaster() -> Any:
    """
    Get whatever can broadcast messages — either the server (parent process)
    or the forwarder (child process). Both have the same .broadcast() interface.
    """
    return get_server() or get_forwarder()

# ---------------------------------------------------------------------------
# State tracking
# ---------------------------------------------------------------------------

# Track which AgentSession instances we've seen (to avoid double-patching)
_patched_sessions: Set[int] = set()

# Track tool call start times for duration calculation
_tool_call_start_times: Dict[str, float] = {}

# Store references to discover agents
_session_agents: Dict[int, Dict[str, Any]] = {}

# Store the original (unpatched) methods so we can call them
_original_emit: Optional[Callable] = None
_original_update_agent: Optional[Callable] = None
_original_start: Optional[Callable] = None


# ---------------------------------------------------------------------------
# Helper: Extract agent info from an Agent instance
# ---------------------------------------------------------------------------

def _extract_agent_info(agent: Any) -> AgentInfo:
    """
    Pull metadata from a LiveKit Agent instance.
    
    The Agent class has these properties (from our SDK research):
      - agent.id → snake_case class name (e.g., "greeting")
      - agent.label → same as id
      - agent.instructions → the system prompt string
      - agent.tools → list of Tool objects with .info.name
    """
    agent_id = getattr(agent, "id", "unknown")
    agent_name = type(agent).__name__  # e.g., "Greeting", "ObjectDetectionAgent"
    instructions = getattr(agent, "instructions", "")
    
    # Extract tool names from the agent's tools list
    tool_names = []
    try:
        tools = getattr(agent, "tools", [])
        for tool in tools:
            info = getattr(tool, "info", None)
            if info:
                name = getattr(info, "name", None) or getattr(info, "raw_schema", {}).get("name", "")
                if name:
                    tool_names.append(name)
    except Exception:
        pass

    return AgentInfo(
        id=agent_id,
        name=agent_name,
        instructions=instructions[:500],  # truncate long instructions
        tools=tool_names,
    )


def _get_session_id(session: Any) -> str:
    """Try to get a meaningful session ID."""
    return str(id(session))


def _get_current_agent_id(session: Any) -> str:
    """Safely get the current agent's ID from a session."""
    try:
        agent = session.current_agent
        return getattr(agent, "id", "unknown")
    except (RuntimeError, AttributeError):
        return "unknown"


# ---------------------------------------------------------------------------
# Helper: Serialize chat context for the inspector
# ---------------------------------------------------------------------------

def _serialize_chat_context(session: Any) -> List[ChatContextItem]:
    """
    Convert the session's chat context (ChatContext) into a list of 
    ChatContextItem for the Chat Inspector panel.
    
    Each item in chat_ctx can be:
      - ChatMessage (with role, content, tool_calls, etc.)
      - FunctionCall
      - FunctionCallOutput  
      - AgentHandoff
    """
    items = []
    try:
        history = session.history
        for item in history.items:
            item_type = getattr(item, "type", "unknown")
            role = getattr(item, "role", "")
            
            # Extract content based on item type
            content = ""
            metadata: dict = {}
            
            if item_type == "message":
                # ChatMessage — extract text content
                msg_content = getattr(item, "content", None)
                if isinstance(msg_content, str):
                    content = msg_content
                elif isinstance(msg_content, list):
                    # Content can be a list of parts (text, image, etc.)
                    text_parts = []
                    for part in msg_content:
                        if hasattr(part, "text"):
                            text_parts.append(part.text)
                        elif isinstance(part, str):
                            text_parts.append(part)
                    content = " ".join(text_parts)
                
                # Check for tool calls within the message
                tool_calls = getattr(item, "tool_calls", None)
                if tool_calls:
                    metadata["tool_calls"] = [
                        {"name": getattr(tc, "name", ""), "arguments": getattr(tc, "arguments", "")}
                        for tc in tool_calls
                    ]
                    
            elif item_type == "function_call":
                content = f"Call: {getattr(item, 'name', '')}({getattr(item, 'arguments', '')})"
                metadata["name"] = getattr(item, "name", "")
                metadata["call_id"] = getattr(item, "call_id", "")
                metadata["arguments"] = getattr(item, "arguments", "")
                
            elif item_type == "function_call_output":
                content = getattr(item, "output", "")
                metadata["name"] = getattr(item, "name", "")
                metadata["call_id"] = getattr(item, "call_id", "")
                metadata["is_error"] = getattr(item, "is_error", False)
                
            elif item_type == "agent_handoff":
                old_id = getattr(item, "old_agent_id", "")
                new_id = getattr(item, "new_agent_id", "")
                content = f"Handoff: {old_id} → {new_id}"
                metadata["old_agent_id"] = old_id
                metadata["new_agent_id"] = new_id
            
            items.append(ChatContextItem(
                item_type=str(item_type),
                role=str(role) if role else "",
                content=content[:2000],  # truncate very long content
                metadata=metadata,
            ))
    except Exception as e:
        logger.debug(f"Failed to serialize chat context: {e}")
    
    return items


# ---------------------------------------------------------------------------
# Patched methods
# ---------------------------------------------------------------------------

def _patched_emit(self: Any, event: str, arg: Any) -> None:
    """
    Replacement for AgentSession.emit().
    
    This is called by LiveKit's internals every time an event fires.
    We intercept it, convert to a Liveflow protocol message, broadcast it,
    then call the original emit so LiveKit continues working normally.
    
    Args:
        self: The AgentSession instance
        event: Event name string (e.g., "agent_state_changed")
        arg: A Pydantic event model (e.g., AgentStateChangedEvent)
    """
    # Always call the original first so LiveKit behavior is unaffected
    _original_emit(self, event, arg)
    
    # Now capture the event for Liveflow
    server = _get_broadcaster()
    if server is None:
        return  # No server or forwarder available, skip silently
    
    session_id = _get_session_id(self)
    agent_id = _get_current_agent_id(self)
    
    try:
        event_type = getattr(arg, "type", event)
        
        # ---- Agent state changed ----
        # Fired when agent goes: initializing → idle → listening → thinking → speaking
        if event_type == "agent_state_changed":
            msg = AgentStateMessage(
                session_id=session_id,
                old_state=str(arg.old_state),
                new_state=str(arg.new_state),
                agent_id=agent_id,
            )
            server.broadcast(msg)
        
        # ---- User state changed ----
        # Fired when user: speaking ↔ listening ↔ away
        elif event_type == "user_state_changed":
            msg = UserStateMessage(
                session_id=session_id,
                old_state=str(arg.old_state),
                new_state=str(arg.new_state),
            )
            server.broadcast(msg)
        
        # ---- User speech transcribed ----
        # Fired as speech-to-text produces results (partial + final)
        elif event_type == "user_input_transcribed":
            msg = TranscriptMessage(
                session_id=session_id,
                speaker="user",
                text=arg.transcript,
                is_final=arg.is_final,
                language=getattr(arg, "language", None),
            )
            server.broadcast(msg)
        
        # ---- Conversation item added ----
        # Fired when a new message/function-call/handoff is added to the chat context
        elif event_type == "conversation_item_added":
            item = arg.item
            item_type = getattr(item, "type", "message")
            role = str(getattr(item, "role", ""))
            
            # Extract content
            content = ""
            metadata: dict = {}
            if item_type == "message":
                raw_content = getattr(item, "content", "")
                if isinstance(raw_content, str):
                    content = raw_content
                elif isinstance(raw_content, list):
                    parts = []
                    for part in raw_content:
                        if hasattr(part, "text"):
                            parts.append(part.text)
                        elif isinstance(part, str):
                            parts.append(part)
                    content = " ".join(parts)
                
                # If this is an agent message, also send it as a transcript
                if role == "assistant" and content:
                    transcript_msg = TranscriptMessage(
                        session_id=session_id,
                        speaker="agent",
                        text=content,
                        is_final=True,
                        agent_id=agent_id,
                    )
                    server.broadcast(transcript_msg)

            elif item_type == "function_call":
                content = f"{getattr(item, 'name', '')}({getattr(item, 'arguments', '')})"
                metadata["name"] = getattr(item, "name", "")
                metadata["call_id"] = getattr(item, "call_id", "")
                
            elif item_type == "function_call_output":
                content = getattr(item, "output", "")
                metadata["name"] = getattr(item, "name", "")
                metadata["call_id"] = getattr(item, "call_id", "")

            msg = ConversationItemMessage(
                session_id=session_id,
                role=role,
                content=content[:2000],
                item_type=str(item_type),
                agent_id=agent_id,
                metadata=metadata,
            )
            server.broadcast(msg)
            
            # Also send a chat context snapshot so the inspector stays up to date
            snapshot = ChatContextSnapshotMessage(
                session_id=session_id,
                items=_serialize_chat_context(self),
                agent_id=agent_id,
            )
            server.broadcast(snapshot)
        
        # ---- Function tools executed ----
        # Fired after all tool calls in a batch complete  
        elif event_type == "function_tools_executed":
            function_calls = getattr(arg, "function_calls", [])
            function_outputs = getattr(arg, "function_call_outputs", [])
            has_handoff = getattr(arg, "_handoff_required", False) or getattr(arg, "has_agent_handoff", False)
            
            for i, fc in enumerate(function_calls):
                call_id = getattr(fc, "call_id", str(i))
                tool_name = getattr(fc, "name", "unknown")
                arguments = getattr(fc, "arguments", "")
                
                # Send tool_call_start (retroactive — we didn't catch the start)
                start_msg = ToolCallStartMessage(
                    session_id=session_id,
                    call_id=call_id,
                    tool_name=tool_name,
                    arguments=arguments,
                    agent_id=agent_id,
                )
                server.broadcast(start_msg)
                
                # Send tool_call_end with output
                output = ""
                is_error = False
                if i < len(function_outputs) and function_outputs[i] is not None:
                    output_obj = function_outputs[i]
                    output = getattr(output_obj, "output", "")
                    is_error = getattr(output_obj, "is_error", False)
                
                # Calculate duration from start time if we tracked it
                duration_ms = 0.0
                start_time = _tool_call_start_times.pop(call_id, None)
                if start_time:
                    duration_ms = (time.time() - start_time) * 1000
                
                end_msg = ToolCallEndMessage(
                    session_id=session_id,
                    call_id=call_id,
                    tool_name=tool_name,
                    output=output[:2000],
                    is_error=is_error,
                    duration_ms=duration_ms,
                    agent_id=agent_id,
                    has_handoff=bool(has_handoff),
                )
                server.broadcast(end_msg)
        
        # ---- Speech created ----
        elif event_type == "speech_created":
            msg = SpeechCreatedMessage(
                session_id=session_id,
                user_initiated=getattr(arg, "user_initiated", False),
                source=str(getattr(arg, "source", "")),
                agent_id=agent_id,
            )
            server.broadcast(msg)
        
        # ---- Metrics collected ----
        elif event_type == "metrics_collected":
            metrics_obj = getattr(arg, "metrics", None)
            metrics_dict = {}
            if metrics_obj:
                try:
                    if hasattr(metrics_obj, "model_dump"):
                        metrics_dict = metrics_obj.model_dump()
                    elif hasattr(metrics_obj, "__dict__"):
                        metrics_dict = {k: v for k, v in metrics_obj.__dict__.items() 
                                       if not k.startswith("_")}
                except Exception:
                    metrics_dict = {"raw": str(metrics_obj)}
            
            msg = MetricsMessage(
                session_id=session_id,
                metrics=metrics_dict,
            )
            server.broadcast(msg)
        
        # ---- Error ----
        elif event_type == "error":
            error_obj = getattr(arg, "error", None)
            source_obj = getattr(arg, "source", None)
            msg = ErrorMessage(
                session_id=session_id,
                error_type=type(error_obj).__name__ if error_obj else "Unknown",
                message=str(error_obj) if error_obj else "",
                source=type(source_obj).__name__ if source_obj else "",
            )
            server.broadcast(msg)
        
        # ---- Session close ----
        elif event_type == "close":
            reason = getattr(arg, "reason", "")
            error = getattr(arg, "error", None)
            msg = SessionEndMessage(
                session_id=session_id,
                reason=str(reason),
                error=str(error) if error else None,
            )
            server.broadcast(msg)

    except Exception as e:
        logger.warning(f"Liveflow interceptor error processing event '{event}': {e}", exc_info=True)


def _patched_update_agent(self: Any, agent: Any) -> None:
    """
    Replacement for AgentSession.update_agent().
    
    This is called when a tool returns a tuple[Agent, str] to trigger a handoff.
    We capture the old → new agent transition and broadcast a HandoffMessage
    so the dashboard graph can animate the transfer.
    """
    server = _get_broadcaster()
    session_id = _get_session_id(self)
    
    # Capture old agent before the update
    old_agent_id = "unknown"
    old_agent_name = "Unknown"
    try:
        old_agent = self.current_agent
        old_agent_id = getattr(old_agent, "id", "unknown")
        old_agent_name = type(old_agent).__name__
    except (RuntimeError, AttributeError):
        pass
    
    # Call the original update_agent (this actually performs the handoff)
    _original_update_agent(self, agent)
    
    # Now broadcast the handoff event
    new_agent_id = getattr(agent, "id", "unknown")
    new_agent_name = type(agent).__name__
    
    if server:
        msg = HandoffMessage(
            session_id=session_id,
            old_agent_id=old_agent_id,
            new_agent_id=new_agent_id,
            old_agent_name=old_agent_name,
            new_agent_name=new_agent_name,
        )
        server.broadcast(msg)
        logger.info(f"Agent handoff: {old_agent_name} → {new_agent_name}")


def _patched_start(original_start: Callable):
    """
    Create a wrapper for AgentSession.start().
    
    We wrap start() to:
    1. Capture the initial agent immediately BEFORE calling start
    2. Send session_init so the panel updates right away
    3. Call the original start (which connects to the room and begins processing)
    
    This is an async method, so we return an async wrapper.
    """
    async def wrapper(self: Any, *args: Any, **kwargs: Any) -> Any:
        server = _get_broadcaster()
        
        # Send session_init BEFORE calling original start, because start()
        # fires agent_state_changed("initializing") internally
        if server:
            session_id = _get_session_id(self)
            
            # The agent is the first positional arg: start(self, agent, *, ...)
            initial_agent = args[0] if args else kwargs.get("agent")
            
            agents_list: list[AgentInfo] = []
            if initial_agent:
                agents_list.append(_extract_agent_info(initial_agent))
            
            # Also try to discover other agents from the agent class hierarchy
            # (e.g. tools that reference other Agent subclasses)
            try:
                if initial_agent:
                    tools = getattr(initial_agent, "tools", [])
                    for tool in tools:
                        info = getattr(tool, "info", None)
                        if info:
                            raw_schema = getattr(info, "raw_schema", {})
                            # Check return type hints for Agent subclasses
                            pass  # We'll discover them via handoff events
            except Exception:
                pass
            
            current_agent_id = getattr(initial_agent, "id", "unknown") if initial_agent else "unknown"
            
            init_msg = SessionInitMessage(
                session_id=session_id,
                agents=agents_list,
                current_agent_id=current_agent_id,
                agent_state="initializing",
                user_state="listening",
            )
            # Use set_session_init so it's stored and replayed to late-connecting clients
            if hasattr(server, "set_session_init"):
                server.set_session_init(init_msg)
            else:
                server.broadcast(init_msg)
            logger.info(f"Session init: {len(agents_list)} agent(s), current={current_agent_id}")
        
        # Now call original start
        result = await original_start(self, *args, **kwargs)
        return result
    
    return wrapper


# ---------------------------------------------------------------------------
# Public API: install / uninstall
# ---------------------------------------------------------------------------

_installed = False


def install() -> None:
    """
    Install Liveflow interceptors on the LiveKit Agents SDK.
    
    This patches:
      - AgentSession.emit → captures all events
      - AgentSession.update_agent → captures handoffs
      - AgentSession.start → captures session init + agent discovery
    
    Call this BEFORE the user's agent.py is imported/executed.
    Safe to call multiple times (no-op if already installed).
    """
    global _installed, _original_emit, _original_update_agent, _original_start
    
    if _installed:
        logger.debug("Liveflow interceptor already installed")
        return
    
    try:
        from livekit.agents.voice.agent_session import AgentSession
    except ImportError:
        logger.error(
            "Could not import livekit.agents. "
            "Make sure livekit-agents is installed in the current Python environment."
        )
        return
    
    # Save originals
    _original_emit = AgentSession.emit
    _original_update_agent = AgentSession.update_agent
    _original_start = AgentSession.start
    
    # Apply patches
    AgentSession.emit = _patched_emit
    AgentSession.update_agent = _patched_update_agent
    AgentSession.start = _patched_start(_original_start)
    
    _installed = True
    logger.info("✓ Liveflow interceptor installed — capturing LiveKit agent events")


def uninstall() -> None:
    """Restore original AgentSession methods."""
    global _installed, _original_emit, _original_update_agent, _original_start
    
    if not _installed:
        return
    
    try:
        from livekit.agents.voice.agent_session import AgentSession
        
        if _original_emit:
            AgentSession.emit = _original_emit
        if _original_update_agent:
            AgentSession.update_agent = _original_update_agent
        if _original_start:
            AgentSession.start = _original_start
            
    except ImportError:
        pass
    
    _installed = False
    _original_emit = None
    _original_update_agent = None
    _original_start = None
    logger.info("Liveflow interceptor uninstalled")
