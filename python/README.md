<p align="center">
  <img src="https://raw.githubusercontent.com/21lakshh/Liveflow/main/packages/webview/public/icon.png" width="80" alt="Liveflow">
</p>

<h1 align="center">liveflow</h1>

<p align="center">
  Real-time visualizer for LiveKit voice agents — see which agent is active, what tools are running, and follow conversations live. <strong>No changes to your agent code.</strong>
</p>

<p align="center">
  <a href="https://pypi.org/project/liveflow"><img src="https://img.shields.io/pypi/v/liveflow" alt="PyPI"></a>
  <a href="https://pypi.org/project/liveflow"><img src="https://img.shields.io/pypi/pyversions/liveflow" alt="Python"></a>
  <a href="https://github.com/21lakshh/Liveflow/blob/main/LICENSE"><img src="https://img.shields.io/github/license/21lakshh/Liveflow" alt="License"></a>
  <a href="https://github.com/21lakshh/Liveflow"><img src="https://img.shields.io/github/stars/21lakshh/Liveflow?style=social" alt="GitHub"></a>
</p>

---

## What is Liveflow?

Liveflow is a **zero-instrumentation debugging companion** for [LiveKit Agents](https://docs.livekit.io/agents). It monkey-patches the LiveKit SDK's `AgentSession` to capture every event — state changes, tool calls, handoffs, transcripts — and streams them over a local HTTP+WebSocket server to a browser dashboard:

- **Agent Graph** — all agents as nodes, active agent highlighted, animated handoff transitions
- **Tool Timeline** — every `@function_tool` call with args, output, duration, and status
- **Conversation Transcript** — live user/agent speech with interim transcripts
- **Chat Context Inspector** — full LLM context window, system prompts, function calls, handoff markers

## Install

```bash
pip install liveflow
```

## Usage

```bash
# Before
python agent.py dev

# After — drop-in replacement
liveflow agent.py dev
```

Your agent runs **exactly as before**. Liveflow captures everything transparently in the background and opens the dashboard at `http://127.0.0.1:<port>` in your default browser.

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

## How It Works

```
┌──────────────────────────┐   HTTP + WebSocket  ┌──────────────────────┐
│  Liveflow Python Shim    │ ──────────────────▶  │  Browser Dashboard   │
│  • Patches AgentSession  │  JSON events + SPA  │  • ReactFlow graph   │
│  • Captures all events   │                     │  • Tool timeline     │
│  • Local WS + HTTP server│                     │  • Transcript view   │
│  • Serves SPA at /       │                     │  • Chat inspector    │
└──────────────────────────┘                     └──────────────────────┘
         ▲
         │  transparent monkey-patch
         │
┌──────────────────────────┐
│  Your agent.py           │  ← UNMODIFIED
│  (LiveKit Agents SDK)    │
└──────────────────────────┘
```

## Source Code

[github.com/21lakshh/Liveflow](https://github.com/21lakshh/Liveflow) — contributions welcome!
