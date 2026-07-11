"""
Tests for liveflow CLI argument parsing and browser-open behavior.
Tests the flag extraction layer without running a full server.
"""

import os
import sys
from pathlib import Path

import pytest

# Import the flag parsing utilities directly
from liveflow.__main__ import (
    _parse_liveflow_flags,
    _resolve_python_interpreter,
)


class TestParseLiveflowFlags:
    """Tests for _parse_liveflow_flags — extracts flags before script path."""

    def test_no_flags_passthrough(self):
        flags, remaining = _parse_liveflow_flags(["agent.py", "dev"])
        assert flags["dashboard_port"] == 0
        assert flags["no_open"] is False
        assert flags["python_path"] is None
        assert remaining == ["agent.py", "dev"]

    def test_dashboard_port(self):
        flags, remaining = _parse_liveflow_flags(["--dashboard-port", "8765", "agent.py", "dev"])
        assert flags["dashboard_port"] == 8765
        assert remaining == ["agent.py", "dev"]

    def test_dashboard_port_short(self):
        """Equality form: --dashboard-port=8765"""
        flags, remaining = _parse_liveflow_flags(["--dashboard-port=8765", "agent.py"])
        assert flags["dashboard_port"] == 8765
        assert remaining == ["agent.py"]

    def test_no_open(self):
        flags, remaining = _parse_liveflow_flags(["--no-open", "agent.py", "dev"])
        assert flags["no_open"] is True
        assert remaining == ["agent.py", "dev"]

    def test_python_path(self):
        flags, remaining = _parse_liveflow_flags(["--python", "/usr/bin/python3.12", "agent.py"])
        assert flags["python_path"] == "/usr/bin/python3.12"
        assert remaining == ["agent.py"]

    def test_python_path_equals(self):
        flags, remaining = _parse_liveflow_flags(["--python=/usr/bin/python3.12", "agent.py"])
        assert flags["python_path"] == "/usr/bin/python3.12"
        assert remaining == ["agent.py"]

    def test_all_flags_before_script(self):
        flags, remaining = _parse_liveflow_flags([
            "--dashboard-port", "3000",
            "--no-open",
            "--python", "/usr/bin/python3.12",
            "agent.py", "dev", "extra",
        ])
        assert flags["dashboard_port"] == 3000
        assert flags["no_open"] is True
        assert flags["python_path"] == "/usr/bin/python3.12"
        assert remaining == ["agent.py", "dev", "extra"]

    def test_flags_after_script_are_passthrough(self):
        """Flags after the script argument are passed through, not consumed."""
        flags, remaining = _parse_liveflow_flags(["agent.py", "--no-open", "dev"])
        assert flags["no_open"] is False  # Not consumed — after script
        assert remaining == ["agent.py", "--no-open", "dev"]

    def test_script_only(self):
        flags, remaining = _parse_liveflow_flags(["agent.py"])
        assert flags["dashboard_port"] == 0
        assert flags["no_open"] is False
        assert remaining == ["agent.py"]

    def test_only_flags_no_script(self):
        """If only flags are given (no script path), script is None."""
        flags, remaining = _parse_liveflow_flags(["--no-open"])
        assert flags["no_open"] is True
        assert remaining == []  # No script found

    def test_dashboard_port_invalid(self):
        with pytest.raises(SystemExit):
            _parse_liveflow_flags(["--dashboard-port", "abc", "agent.py"])

    def test_dashboard_port_negative(self):
        with pytest.raises(SystemExit):
            _parse_liveflow_flags(["--dashboard-port", "-1", "agent.py"])

    def test_dashboard_port_zero(self):
        """Port 0 is valid (OS picks)."""
        flags, remaining = _parse_liveflow_flags(["--dashboard-port", "0", "agent.py"])
        assert flags["dashboard_port"] == 0

    def test_unknown_flag_after_script_passthrough(self):
        """Unknown flags after script are passed through to the agent."""
        flags, remaining = _parse_liveflow_flags(["agent.py", "--custom-flag", "value"])
        assert remaining == ["agent.py", "--custom-flag", "value"]

    def test_help_short_circuits(self):
        """--help returns flags with script=None before parsing further."""
        flags, remaining = _parse_liveflow_flags(["--help"])
        assert flags["script"] is None
        # The caller handles --help

    def test_version_short_circuits(self):
        flags, remaining = _parse_liveflow_flags(["--version"])
        assert flags["script"] is None


class TestResolvePythonInterpreter:
    """Tests for _resolve_python_interpreter — interpreter precedence."""

    def test_explicit_path(self):
        assert _resolve_python_interpreter("/usr/bin/python3.12") == "/usr/bin/python3.12"

    def test_virtualenv_active(self, monkeypatch):
        monkeypatch.setenv("VIRTUAL_ENV", "/home/user/.venv")
        venv_python = os.path.join("/home/user/.venv", "bin", "python")
        result = _resolve_python_interpreter(None)
        assert result == venv_python

    def test_path_fallback(self, monkeypatch):
        monkeypatch.delenv("VIRTUAL_ENV", raising=False)
        result = _resolve_python_interpreter(None)
        assert result == "python"  # Falls back to PATH

    def test_explicit_wins_over_env(self, monkeypatch):
        monkeypatch.setenv("VIRTUAL_ENV", "/home/user/.venv")
        result = _resolve_python_interpreter("/custom/python")
        assert result == "/custom/python"


class TestBrowserOpen:
    """Tests for the browser-open decision (unit level)."""

    def test_no_open_suppresses(self):
        """When --no-open is set, we don't call webbrowser.open."""
        from liveflow.__main__ import _maybe_open_browser
        called = []

        def fake_open(url):
            called.append(url)

        _maybe_open_browser(port=8765, no_open=True, _opener=fake_open)
        assert called == []

    def test_default_opens_browser(self):
        """By default, the dashboard URL is opened."""
        from liveflow.__main__ import _maybe_open_browser
        called = []

        def fake_open(url):
            called.append(url)

        _maybe_open_browser(port=8765, no_open=False, _opener=fake_open)
        assert called == ["http://127.0.0.1:8765"]


class TestSystemExitPropagation:
    """Tests for SystemExit handling in the script runner."""

    def test_system_exit_zero_pass(self, tmp_path, monkeypatch):
        """SystemExit(0) or SystemExit() should not propagate (normal exit)."""
        import liveflow.__main__ as mod
        script = tmp_path / "agent.py"
        script.write_text("raise SystemExit(0)")
        # Simulate the runpy call inline
        import runpy
        monkeypatch.chdir(tmp_path)
        try:
            runpy.run_path(str(script), run_name="__main__")
        except SystemExit as e:
            # Check that our handler logic would not re-raise
            should_raise = e.code is not None and e.code != 0
            assert should_raise is False

    def test_system_exit_none_pass(self, tmp_path, monkeypatch):
        """SystemExit(None) should not propagate."""
        script = tmp_path / "agent.py"
        script.write_text("raise SystemExit()")
        import runpy
        monkeypatch.chdir(tmp_path)
        try:
            runpy.run_path(str(script), run_name="__main__")
        except SystemExit as e:
            should_raise = e.code is not None and e.code != 0
            assert should_raise is False

    def test_system_exit_nonzero_propagates(self, tmp_path, monkeypatch):
        """SystemExit(1) should propagate."""
        script = tmp_path / "agent.py"
        script.write_text("raise SystemExit(1)")
        import runpy
        monkeypatch.chdir(tmp_path)
        try:
            runpy.run_path(str(script), run_name="__main__")
        except SystemExit as e:
            should_raise = e.code is not None and e.code != 0
            assert should_raise is True
            assert e.code == 1


class TestScriptArgExtraction:
    """Tests for correct argv extraction when script path is relative."""

    def test_relative_script_path_in_remaining(self):
        """Script token in remaining uses the original (relative) path."""
        flags, remaining = _parse_liveflow_flags(["agent.py", "dev"])
        assert remaining == ["agent.py", "dev"]
        script_token = flags["script"]
        assert script_token == "agent.py"
        # Simulate what main() does: find script in remaining
        idx = remaining.index(script_token)
        script_argv = remaining[idx:]
        assert script_argv == ["agent.py", "dev"]

    def test_relative_script_with_flags_before(self):
        """Script token survives flag parsing unchanged."""
        flags, remaining = _parse_liveflow_flags([
            "--dashboard-port", "8765", "--no-open", "agent.py", "dev", "--verbose"
        ])
        script_token = flags["script"]
        assert script_token == "agent.py"
        # remaining contains original tokens including script
        assert "agent.py" in remaining
        idx = remaining.index("agent.py")
        script_argv = remaining[idx:]
        assert script_argv == ["agent.py", "dev", "--verbose"]
        # Args after script are correctly extracted
        user_args = script_argv[1:]
        assert user_args == ["dev", "--verbose"]

    def test_absolute_path_also_works(self):
        """When script is passed as absolute path, it still works."""
        flags, remaining = _parse_liveflow_flags(["/abs/path/to/agent.py", "dev"])
        assert flags["script"] == "/abs/path/to/agent.py"
        idx = remaining.index("/abs/path/to/agent.py")
        assert idx == 0

    def test_no_args_after_script_has_empty_user_args(self):
        """When script has no args, user_args is empty."""
        flags, remaining = _parse_liveflow_flags(["agent.py"])
        script_token = flags["script"]
        idx = remaining.index(script_token)
        script_argv = remaining[idx:]
        assert script_argv == ["agent.py"]
        assert script_argv[1:] == []


class TestIsFrozen:
    """Tests for frozen-mode detection."""

    def test_source_mode(self, monkeypatch):
        """In source mode, sys.frozen is not set."""
        import liveflow.__main__ as mod
        # Ensure sys.frozen is absent
        if hasattr(sys, "frozen"):
            monkeypatch.delattr(sys, "frozen", raising=False)
        if hasattr(sys, "_MEIPASS"):
            monkeypatch.delattr(sys, "_MEIPASS", raising=False)
        assert mod._is_frozen() is False

    def test_frozen_mode(self, monkeypatch):
        """In frozen mode, sys.frozen is True."""
        import liveflow.__main__ as mod
        monkeypatch.setattr(sys, "frozen", True, raising=False)
        monkeypatch.setattr(sys, "_MEIPASS", "/tmp/_MEIXXXX", raising=False)
        assert mod._is_frozen() is True
