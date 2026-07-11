# Liveflow — Real-time LiveKit Agent Visualizer

> Browser dashboard + Python companion that lets you **visualize LiveKit agent conversations in real-time** — see which agent is active, what tools are running, and follow conversations live. **No changes to your agent code.**

## How It Works

Liveflow has two parts:

### 1. Python Package (`liveflow`)
A pip-installable wrapper that runs alongside your LiveKit agent. It monkey-patches the LiveKit SDK's `AgentSession` to intercept events (state changes, tool calls, handoffs, transcripts) and streams them over a local WebSocket.

### 2. Browser Dashboard
A React SPA served by the Liveflow Python process on a single local port (default: random). Open `http://127.0.0.1:<port>` in any browser to see:

- **Agent Graph** — ReactFlow visualization showing all agents as nodes, with the active agent highlighted and animated handoff transitions
- **Tool Timeline** — Every `@function_tool` execution with args, output, duration, and status
- **Conversation Transcript** — Live user/agent speech with interim transcripts
- **Chat Context Inspector** — Full LLM context window including system prompts, function calls, and handoff markers
- **State Indicator** — Real-time agent state (listening/thinking/speaking) and user mic status

## Quick Start

### 1. Install the Python package

```bash
pip install liveflow
```

### 2. Run your agent with Liveflow

```bash
# Before
python agent.py dev

# After — drop-in replacement
liveflow agent.py dev
```

Your agent runs exactly as before. Liveflow captures everything transparently in the background.

### 3. Open the Dashboard

Liveflow opens `http://127.0.0.1:<port>` in your default browser automatically. No VS Code, no extensions — just a browser tab.

### Flags

| Flag | Description |
|------|-------------|
| `--dashboard-port PORT` | Bind dashboard to a specific port (default: random) |
| `--no-open` | Don't open the browser automatically |
| `--python PYTHON` | Python interpreter for agent subprocess |

```bash
# Custom port, no browser
liveflow --dashboard-port 8765 --no-open agent.py dev

# Explicit Python interpreter
liveflow --python ~/venv/livekit/bin/python agent.py dev
```

## Architecture

```
┌──────────────────────────┐    WebSocket     ┌──────────────────────┐
│  Liveflow Python Shim    │ ──────────────▶  │  Browser Dashboard   │
│                          │   JSON events    │                      │
│  • Patches AgentSession  │                  │  • ReactFlow graph   │
│  • Captures all events   │                  │  • Tool timeline     │
│  • Local WS + HTTP server│                  │  • Transcript view   │
│  • Serves SPA at /       │                  │  • Chat inspector    │
└──────────────────────────┘                  └──────────────────────┘
         ▲
         │  transparent monkey-patch
         │
┌──────────────────────────┐
│  Your agent.py           │  ← UNMODIFIED
│  (LiveKit Agents SDK)    │
└──────────────────────────┘
```

### Intercepted Events

| Event | What Liveflow Captures |
|-------|----------------------|
| `agent_state_changed` | Agent transitions: listening → thinking → speaking |
| `user_state_changed` | User mic: speaking ↔ listening ↔ away |
| `user_input_transcribed` | Real-time speech-to-text (partial + final) |
| `conversation_item_added` | Every message in the chat context |
| `function_tools_executed` | Tool name, arguments, output, duration |
| `update_agent()` | Agent handoffs (old → new agent) |
| `session.start()` | Agent registry discovery |
| `metrics_collected` | LLM/STT/TTS performance metrics |
| `error` | Pipeline errors |

## Project Structure

```
Liveflow/
├── liveflow.spec              # PyInstaller spec — onefile executable build
├── .pip3r/
│   └── recipes/
│       └── pyinstaller.yaml   # pip3r recipe for PyInstaller build
│
├── packages/
│   └── webview/               # React dashboard SPA (Vite)
│       └── src/
│           ├── App.tsx
│           ├── store/index.ts  # Zustand state
│           └── components/
│               ├── AgentGraph.tsx
│               ├── ToolTimeline.tsx
│               ├── Transcript.tsx
│               ├── ChatInspector.tsx
│               └── StateIndicator.tsx
│
├── python/                    # pip-installable Python package
│   ├── pyproject.toml
│   └── liveflow/
│       ├── __main__.py        # CLI entry — flag parsing, server startup
│       ├── _frozen_entry.py   # PyInstaller onefile entry point
│       ├── http_handler.py    # HTTP server — SPA serving, MIME types
│       ├── ws_server.py       # WebSocket + combined server lifecycle
│       ├── interceptor.py     # SDK monkey-patching
│       ├── protocol.py        # Pydantic message schemas
│       ├── code_scanner.py    # Static analysis — agent/tool discovery
│       ├── child_hook.py      # Child process hook injection
│       ├── forwarder.py       # WS client in child processes
│       └── proc_main_wrapper.py # LiveKit IPC intercept
│
└── apps/
    └── landing/               # Next.js marketing site
```

## Development

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9
- Python ≥ 3.9

### Install dependencies

```bash
npm install
```

### Build the SPA (required before running from source)

```bash
npm run build -w @liveflow/webview
```

Or build everything:

```bash
npx turbo run build
```

### Run from source (local dev install)

```bash
cd python
pip install -e .
```

Now you can use `liveflow agent.py dev` from anywhere — it uses the local SPA build from `packages/webview/dist/`.

### Build the Python package for PyPI

```bash
cd python
python -m build
```

### Build the onefile executable

Prerequisite: the SPA must be built first (`npm run build -w @liveflow/webview`).

```bash
pip3r pyinstaller --noconfirm --clean liveflow.spec
```

Output is at `dist/liveflow` — a single-file executable for the current platform. Build separately per target platform (Linux, macOS, Windows) by running the command on each.

### Runtime contract

The onefile executable bundles its own Python runtime for Liveflow itself. Your agent still runs in its own Python environment, resolved at launch using this precedence:

1. `--python PATH` flag (explicit)
2. `$VIRTUAL_ENV/bin/python` (active virtual environment)
3. `python` from `PATH`

This means your agent dependencies (LiveKit Agents SDK, etc.) must be installed in the resolved interpreter's environment. The executable bundles Liveflow, its private Python runtime, and the SPA assets; it deliberately does not freeze arbitrary agent dependencies.

```
# Example — explicit interpreter
liveflow --python /path/to/venv/bin/python agent.py dev
```

### Test end-to-end

```bash
# Terminal 1: run your agent via Liveflow
cd /path/to/your/agent
liveflow agent.py dev

# Dashboard opens at http://127.0.0.1:<port>
# The first release is loopback-only; open it on the same machine.
```

## Requirements

- **Python**: ≥ 3.9
- **LiveKit Agents SDK**: ≥ 1.0.0
- **Node.js**: ≥ 18 (development only)
- **Browser**: any modern browser (Chrome, Firefox, Safari, Edge)

## License

MIT
