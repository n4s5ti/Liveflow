from __future__ import annotations

import atexit
import logging
import os
import site
import sys
import runpy
import webbrowser
from typing import Optional


# Configure Liveflow logging
logger = logging.getLogger("liveflow")

# Name of the .pth file we install into site-packages
_PTH_FILENAME = "liveflow-hook.pth"


def _get_site_packages_dir() -> str | None:
    """Find the site-packages directory for the current Python environment."""
    # Prefer the virtualenv's site-packages if we're in one
    for p in site.getsitepackages():
        if os.path.isdir(p):
            return p
    # Fallback to user site-packages
    user_site = site.getusersitepackages()
    if isinstance(user_site, str) and os.path.isdir(user_site):
        return user_site
    return None


def _install_pth_file() -> str | None:
    """
    Write a .pth file into site-packages so that EVERY Python subprocess
    (including watchfiles' reload subprocess) auto-installs the child hook.
    
    The .pth file just imports liveflow._auto_hook, which:
      - Checks LIVEFLOW_PORT env var
      - If set, patches proc_main → proc_main_wrapper
      - Does nothing if not set (safe for non-Liveflow processes)
    
    Returns the path to the .pth file, or None if it couldn't be installed.
    """
    sp_dir = _get_site_packages_dir()
    if not sp_dir:
        logger.warning("Could not find site-packages directory for .pth file")
        return None
    
    pth_path = os.path.join(sp_dir, _PTH_FILENAME)
    try:
        with open(pth_path, "w") as f:
            f.write("import liveflow._auto_hook\n")
        logger.debug(f"Installed .pth file: {pth_path}")
        return pth_path
    except OSError as e:
        logger.warning(f"Could not write .pth file to {pth_path}: {e}")
        return None


def _uninstall_pth_file(pth_path: str) -> None:
    """Remove the .pth file on exit."""
    try:
        if os.path.exists(pth_path):
            os.remove(pth_path)
            logger.debug(f"Removed .pth file: {pth_path}")
    except OSError:
        pass  # Best effort cleanup


def _setup_logging() -> None:
    """Set up Liveflow-specific logging that doesn't interfere with LiveKit's logging."""
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter(
        "\033[36m[liveflow]\033[0m %(message)s"  # Cyan prefix for easy identification
    ))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


def _print_banner(port: int, script: str, flags: dict | None = None) -> None:
    """Print a startup banner so the user knows Liveflow is active."""
    print("\033[36m" + "=" * 60 + "\033[0m")
    print("\033[36m  🔍 Liveflow — LiveKit Agent Visualizer\033[0m")
    print(f"\033[36m  Dashboard:  http://127.0.0.1:{port}\033[0m")
    print(f"\033[36m  WebSocket:  ws://127.0.0.1:{port}/ws\033[0m")
    print(f"\033[36m  Script:     {script}\033[0m")
    if flags:
        print(f"\033[36m  Args:       {' '.join(flags.get('remaining', []))}"
              if flags.get('remaining') else f"\033[36m  Args:       (none)")
    print("\033[36m" + "=" * 60 + "\033[0m")


def _print_help() -> None:
    """Print a rich help screen."""
    from . import __version__
    c = "\033[36m"   # cyan
    b = "\033[1m"    # bold
    g = "\033[32m"   # green
    y = "\033[33m"   # yellow
    d = "\033[2m"    # dim
    r = "\033[0m"    # reset

    print(f"""
{c}{b}  🔍 Liveflow {__version__} — LiveKit Agent Visualizer{r}
{d}  Real-time debugger for LiveKit voice agents. No code changes needed.{r}

{b}Usage:{r}
  {g}liveflow{r} {d}[flags]{r} {y}<agent.py>{r} {y}[mode]{r} {d}[args...]{r}
  {g}liveflow{r} {y}<command>{r}

{b}Flags (before script):{r}
  {g}--dashboard-port{r} {y}PORT{r}   Bind dashboard to a specific port (default: random)
  {g}--no-open{r}                Don't open the browser automatically
  {g}--python{r} {y}PYTHON{r}        Python interpreter for agent subprocess

{b}Commands:{r}
  {g}--help{r}, {g}-h{r}      Show this help message
  {g}--version{r}, {g}-V{r}   Show version number

{b}Examples:{r}
  {g}liveflow agent.py dev{r}

  {d}# Custom port, no browser{r}
  {g}liveflow --dashboard-port 8765 --no-open agent.py dev{r}

  {d}# Pass extra args through to your agent{r}
  {g}liveflow agent.py dev --log-level DEBUG{r}

{b}Source:{r}
  {d}github.com/21lakshh/Liveflow{r}
""")



# ---------------------------------------------------------------------------
# Flag parsing: extract Liveflow flags before the user's script
# ---------------------------------------------------------------------------

def _parse_liveflow_flags(argv: list[str]) -> tuple[dict, list[str]]:
    """
    Extract Liveflow flags from argv, stopping at the first non-flag
    argument (the user's script). Everything after the script is passed
    through unchanged.

    Returns (flags_dict, remaining_argv).
    """
    flags = {
        "dashboard_port": 0,
        "no_open": False,
        "python_path": None,
        "script": None,
    }
    remaining = []
    i = 0
    script_found = False

    while i < len(argv):
        arg = argv[i]

        if not script_found:
            if arg == "--dashboard-port":
                i += 1
                if i >= len(argv):
                    print("Error: --dashboard-port requires a value", file=sys.stderr)
                    sys.exit(1)
                try:
                    port = int(argv[i])
                    if port < 0 or port > 65535:
                        raise ValueError
                    flags["dashboard_port"] = port
                except ValueError:
                    print(f"Error: Invalid port number: {argv[i]}", file=sys.stderr)
                    sys.exit(1)
                i += 1
                continue

            if arg.startswith("--dashboard-port="):
                try:
                    port = int(arg.split("=", 1)[1])
                    if port < 0 or port > 65535:
                        raise ValueError
                    flags["dashboard_port"] = port
                except ValueError:
                    print(f"Error: Invalid port number: {arg.split('=', 1)[1]}", file=sys.stderr)
                    sys.exit(1)
                i += 1
                continue

            if arg == "--no-open":
                flags["no_open"] = True
                i += 1
                continue

            if arg == "--python":
                i += 1
                if i >= len(argv):
                    print("Error: --python requires a value", file=sys.stderr)
                    sys.exit(1)
                flags["python_path"] = argv[i]
                i += 1
                continue

            if arg.startswith("--python="):
                flags["python_path"] = arg.split("=", 1)[1]
                i += 1
                continue

            # First non-flag argument is the script
            if not arg.startswith("-"):
                flags["script"] = arg
                script_found = True
                remaining.append(arg)
                i += 1
                continue

        # Everything else (including unknown flags) is passed through
        remaining.append(arg)
        i += 1

    return flags, remaining


# ---------------------------------------------------------------------------
# Python interpreter resolution
# ---------------------------------------------------------------------------

def _resolve_python_interpreter(explicit: Optional[str]) -> str:
    """
    Resolve the Python interpreter to use for launching agent subprocess.

    Precedence:
    1. Explicit --python flag
    2. VIRTUAL_ENV environment variable
    3. "python" from PATH
    """
    if explicit:
        return explicit

    venv = os.environ.get("VIRTUAL_ENV")
    if venv:
        return os.path.join(venv, "bin", "python")

    return "python"


# ---------------------------------------------------------------------------
# Browser open
# ---------------------------------------------------------------------------

def _maybe_open_browser(port: int, no_open: bool = False, _opener=None) -> None:
    """
    Open the dashboard in the default browser, unless --no-open was set.

    Args:
        port: The dashboard port.
        no_open: If True, suppress browser open.
        _opener: Test injection point for webbrowser.open.
    """
    if no_open:
        return
    url = f"http://127.0.0.1:{port}"
    opener = _opener or webbrowser.open
    try:
        opener(url)
        logger.info(f"Dashboard opened at {url}")
    except Exception as e:
        logger.debug(f"Could not open browser: {e}")


# ---------------------------------------------------------------------------
# Frozen mode detection
# ---------------------------------------------------------------------------

def _is_frozen() -> bool:
    """Return True if running as a PyInstaller onefile executable."""
    return getattr(sys, "frozen", False)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def main() -> None:
    """
    Main entry point.

    Parses args, starts the server + hook, then runs the user's script.
    The user's script gets sys.argv as if it was run directly:
        liveflow agent.py dev  →  sys.argv = ["agent.py", "dev"]

    Flags consumed before the script:
        --dashboard-port PORT   Bind dashboard to a specific port
        --no-open               Don't open the browser
        --python PYTHON_PATH    Python interpreter for agent subprocess
    """
    _setup_logging()

    # ---- Parse flags ----
    flags, remaining = _parse_liveflow_flags(sys.argv[1:])

    # ---- Handle help / version / no script ----
    if len(sys.argv) < 2 or sys.argv[1] in ("--help", "-h", "help"):
        _print_help()
        sys.exit(0)

    if sys.argv[1] in ("--version", "-V", "version"):
        from . import __version__
        print(f"liveflow {__version__}")
        sys.exit(0)

    if flags["script"] is None:
        _print_help()
        sys.exit(0)

    script_path = flags["script"]
    # Save original relative token before absolutizing — used later for
    # argv extraction from remaining (which preserves original tokens).
    _script_token = script_path

    # Validate the script exists
    if not os.path.isfile(script_path):
        abs_path = os.path.join(os.getcwd(), script_path)
        if os.path.isfile(abs_path):
            script_path = abs_path
        else:
            print(f"Error: Script not found: {script_path}")
            sys.exit(1)

    script_path = os.path.abspath(script_path)

    # ---- Discover SPA directory ----
    from .http_handler import find_spa_dir
    spa_dir = find_spa_dir()
    if spa_dir:
        logger.info(f"Serving dashboard from {spa_dir}")
    else:
        logger.info("No SPA build found — WebSocket-only mode")

    # ---- Step 1: Start WebSocket/HTTP server ----
    logger.info("Starting Liveflow server...")

    from .ws_server import start_server
    server = start_server(port=flags["dashboard_port"], spa_dir=spa_dir)
    atexit.register(server.stop)

    flags["remaining"] = remaining[remaining.index(_script_token) + 1:]
    _print_banner(server.port, script_path, flags)

    # ---- Open browser ----
    _maybe_open_browser(server.port, no_open=flags["no_open"])

    # ---- Resolve Python interpreter (used by frozen launcher) ----
    python_path = _resolve_python_interpreter(flags["python_path"])
    os.environ["LIVEFLOW_PYTHON"] = python_path

    # ---- Step 1b: Scan agent code (static analysis) ----
    logger.info("Scanning agent code for agents and tools...")
    from .code_scanner import scan_agent_file
    from .protocol import AgentInfo, CodeScanMessage, ScannedHandoff

    scan_result = scan_agent_file(script_path)
    if scan_result["agents"]:
        scan_msg = CodeScanMessage(
            agents=[
                AgentInfo(
                    id=a["id"],
                    name=a["name"],
                    instructions=a.get("instructions", ""),
                    tools=a.get("tools", []),
                )
                for a in scan_result["agents"]
            ],
            handoffs=[
                ScannedHandoff(
                    from_id=h["from_id"],
                    to_id=h["to_id"],
                    tool=h.get("tool", ""),
                )
                for h in scan_result["handoffs"]
            ],
        )
        server.set_initial_scan(scan_msg)
        logger.info(f"Code scan: {len(scan_result['agents'])} agents, {len(scan_result['handoffs'])} handoffs")

    # ---- Step 2: Set LIVEFLOW_PORT for child processes ----
    os.environ["LIVEFLOW_PORT"] = str(server.port)

    # ---- Step 3: Install hooks for child processes ----
    logger.info("Installing child process hooks...")

    from .child_hook import install_child_process_hook
    install_child_process_hook()

    pth_path = _install_pth_file()
    if pth_path:
        atexit.register(_uninstall_pth_file, pth_path)

    # ---- Step 4: Run the user's script ----
    # Remaining args after script become sys.argv for the agent.
    # Use the original script token (before absolutizing) since remaining
    # preserves tokens as they appeared on the command line.
    script_argv = remaining[remaining.index(_script_token):]
    sys.argv = script_argv

    script_dir = os.path.dirname(script_path)
    if script_dir:
        os.chdir(script_dir)
        if script_dir not in sys.path:
            sys.path.insert(0, script_dir)

    logger.info(f"Running {os.path.basename(script_path)}...")

    try:
        runpy.run_path(script_path, run_name="__main__")
    except SystemExit as e:
        if e.code is not None and e.code != 0:
            raise
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
    except Exception as e:
        logger.error(f"Script error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
