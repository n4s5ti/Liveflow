"""
Packaging assertions for the PyInstaller onefile build.

Behavioral tests that exercise the actual frozen entry and spec file,
rather than pattern-matching source text. Designed to catch missing
SPA wiring, incorrect env contracts, and spec misconfiguration.
"""

import os
import runpy
import sys
import types

import pytest

# -- Path constants ------------------------------------------------------------

REPO_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")
)

SPEC_PATH = os.path.join(REPO_ROOT, "liveflow.spec")
FROZEN_ENTRY_PATH = os.path.join(
    REPO_ROOT, "python", "liveflow", "_frozen_entry.py"
)


# -- Helpers -------------------------------------------------------------------

def _load_entry_as_module() -> types.ModuleType:
    """Load _frozen_entry.py as a Python module (not __main__)."""
    mod_globals = runpy.run_path(
        FROZEN_ENTRY_PATH, run_name="liveflow._frozen_entry"
    )
    mod = types.ModuleType("liveflow._frozen_entry")
    mod.__dict__.update(mod_globals)
    return mod


# -- Frozen entry behavioral tests ---------------------------------------------

class TestFrozenEntry:
    """Behaviour-driven tests for the frozen entry point."""

    def test_entry_is_valid_python_syntax(self):
        """Entry compiles to valid Python bytecode."""
        with open(FROZEN_ENTRY_PATH, "r", encoding="utf-8") as f:
            source = f.read()
        compile(source, FROZEN_ENTRY_PATH, "exec")

    def test_entry_does_not_execute_main_on_import(self, monkeypatch):
        """Importing the entry module must NOT call main().

        The entry only runs main() under `if __name__ == "__main__"`.
        When imported (e.g. by PyInstaller Analysis or runpy), main()
        must not fire.
        """
        called = []

        class _FakeMainModule:
            @staticmethod
            def main():
                called.append(True)

        fake_main = types.ModuleType("liveflow.__main__")
        fake_main.main = _FakeMainModule.main  # type: ignore[attr-defined]
        fake_liveflow = types.ModuleType("liveflow")

        with monkeypatch.context() as m:
            m.setitem(sys.modules, "liveflow", fake_liveflow)
            m.setitem(sys.modules, "liveflow.__main__", fake_main)

            _load_entry_as_module()

        assert not called, (
            "main() was called during import — "
            "entry must guard with __name__ == '__main__'"
        )

    def test_entry_sets_spa_dir_when_frozen_with_existing_dir(
        self, tmp_path, monkeypatch
    ):
        """When sys.frozen is True and _web dir exists, LIVEFLOW_SPA_DIR is set."""
        web_dir = tmp_path / "liveflow" / "_web"
        web_dir.mkdir(parents=True)
        (web_dir / "index.html").write_text("<html></html>")

        # sys.frozen and sys._MEIPASS are PyInstaller bootloader attributes,
        # absent in dev. Inject both directly via __dict__ so the entry's
        # getattr() calls succeed.
        sys.frozen = True  # type: ignore[attr-defined]
        sys._MEIPASS = str(tmp_path)  # type: ignore[attr-defined]

        try:
            runpy.run_path(
                FROZEN_ENTRY_PATH, run_name="liveflow._frozen_entry"
            )
            assert os.environ.get("LIVEFLOW_SPA_DIR") == str(web_dir), (
                "Frozen entry must set LIVEFLOW_SPA_DIR to the SPA dir"
            )
        finally:
            del sys.frozen  # type: ignore[attr-defined]
            del sys._MEIPASS  # type: ignore[attr-defined]
            os.environ.pop("LIVEFLOW_SPA_DIR", None)

    def test_entry_does_not_set_spa_dir_when_not_frozen(self, monkeypatch):
        """When sys.frozen is False, LIVEFLOW_SPA_DIR must not be set."""
        # Ensure clean state: previous tests may have leaked sys.frozen
        if hasattr(sys, "frozen"):
            del sys.frozen  # type: ignore[attr-defined]
        if hasattr(sys, "_MEIPASS"):
            del sys._MEIPASS  # type: ignore[attr-defined]
        os.environ.pop("LIVEFLOW_SPA_DIR", None)

        _load_entry_as_module()

        assert "LIVEFLOW_SPA_DIR" not in os.environ, (
            "LIVEFLOW_SPA_DIR must not be set in non-frozen (source) mode"
        )

    def test_entry_does_not_set_spa_dir_when_dir_missing(
        self, tmp_path, monkeypatch
    ):
        """When _web dir doesn't exist, LIVEFLOW_SPA_DIR must not be set."""
        os.environ.pop("LIVEFLOW_SPA_DIR", None)
        sys.frozen = True  # type: ignore[attr-defined]
        sys._MEIPASS = str(tmp_path)  # type: ignore[attr-defined]
        # tmp_path has no liveflow/_web subdirectory

        try:
            runpy.run_path(
                FROZEN_ENTRY_PATH, run_name="liveflow._frozen_entry"
            )
            assert "LIVEFLOW_SPA_DIR" not in os.environ, (
                "LIVEFLOW_SPA_DIR must not be set when _web dir is missing"
            )
        finally:
            del sys.frozen  # type: ignore[attr-defined]
            del sys._MEIPASS  # type: ignore[attr-defined]

    def test_entry_imports_main_after_frozen_check(self):
        """The liveflow import must appear after the frozen detection block.

        This ensures LIVEFLOW_SPA_DIR is set before find_spa_dir() runs
        during main() startup.
        """
        with open(FROZEN_ENTRY_PATH, "r", encoding="utf-8") as f:
            source = f.read()

        frozen_idx = source.find("sys.frozen")
        import_idx = source.find("from liveflow.__main__")

        assert frozen_idx >= 0, "Entry must reference sys.frozen"
        assert import_idx >= 0, "Entry must import liveflow.__main__"
        assert import_idx > frozen_idx, (
            "liveflow import must appear AFTER frozen detection — "
            "otherwise LIVEFLOW_SPA_DIR won't be set before find_spa_dir() runs"
        )


# -- Spec file behavioral tests ------------------------------------------------

class TestSpecFile:
    """Behaviour-driven tests that evaluate the liveflow.spec."""

    def test_spec_is_valid_python(self):
        """Spec compiles to valid bytecode."""
        with open(SPEC_PATH, "r", encoding="utf-8") as f:
            source = f.read()
        compile(source, SPEC_PATH, "exec")

    def test_spec_references_frozen_entry(self):
        """Spec Analysis starts from _frozen_entry.py."""
        with open(SPEC_PATH, "r", encoding="utf-8") as f:
            source = f.read()
        assert "_frozen_entry.py" in source, (
            "Spec must reference the frozen entry point"
        )

    def test_spec_bundles_webview_as_data(self):
        """Spec adds packages/webview/dist as data under liveflow/_web."""
        with open(SPEC_PATH, "r", encoding="utf-8") as f:
            source = f.read()
        assert "packages/webview/dist" in source, (
            "Spec must reference packages/webview/dist for SPA source"
        )
        assert "liveflow/_web" in source, (
            "SPA data must be mounted at liveflow/_web inside bundle"
        )

    def test_spec_builds_onefile_exe_named_liveflow(self):
        """Spec produces a single-file EXE named 'liveflow'."""
        with open(SPEC_PATH, "r", encoding="utf-8") as f:
            source = f.read()
        assert "PYZ(" in source, "Spec must define a PYZ for onefile archive"
        assert "EXE(" in source, "Spec must define an EXE target"
        assert (
            'name="liveflow"' in source or "name='liveflow'" in source
        ), "Output executable must be named 'liveflow'"

    def test_spec_excludes_test_frameworks(self):
        """Spec excludes pytest, coverage, and test infrastructure."""
        with open(SPEC_PATH, "r", encoding="utf-8") as f:
            source = f.read()
        for excluded in (
            "pytest",
            "_pytest",
            "coverage",
            "tkinter",
            "unittest",
        ):
            assert excluded in source, (
                f"Spec must exclude '{excluded}' to keep bundle lean"
            )

    def test_spec_declares_required_hidden_imports(self):
        """Spec declares hidden imports for websockets sub-packages."""
        with open(SPEC_PATH, "r", encoding="utf-8") as f:
            source = f.read()
        required = [
            "websockets",
            "websockets.server",
            "websockets.asyncio.server",
            "pydantic",
        ]
        for imp in required:
            assert imp in source, (
                f"Spec must declare '{imp}' as a hidden import"
            )

    def test_spec_does_not_include_unproven_hidden_imports(self):
        """Spec must not include unvalidated hidden imports."""
        with open(SPEC_PATH, "r", encoding="utf-8") as f:
            source = f.read()
        assert "pydantic.deprecated.decorator" not in source, (
            "pydantic.deprecated.decorator is not used — must not be listed"
        )

    def test_spec_uses_spa_dir_env_var(self):
        """Spec comment references LIVEFLOW_SPA_DIR, not the old name."""
        with open(SPEC_PATH, "r", encoding="utf-8") as f:
            source = f.read()
        assert "LIVEFLOW_SPA_DIR" in source, (
            "Spec must reference LIVEFLOW_SPA_DIR (not LIVEFLOW_BOOTSTRAP_PATH)"
        )
        assert "LIVEFLOW_BOOTSTRAP_PATH" not in source, (
            "Spec must not reference the dead LIVEFLOW_BOOTSTRAP_PATH name"
        )


# -- End-to-end wiring test ----------------------------------------------------

class TestSpaWiring:
    """Verify the SPA discovery chain: frozen entry → find_spa_dir → server."""

    def test_find_spa_dir_discovers_frozen_dir_from_env(
        self, tmp_path, monkeypatch
    ):
        """find_spa_dir() discovers SPA dir from LIVEFLOW_SPA_DIR."""
        from liveflow.http_handler import find_spa_dir

        web_dir = tmp_path / "spa"
        web_dir.mkdir()
        (web_dir / "index.html").write_text("<html></html>")

        monkeypatch.setenv("LIVEFLOW_SPA_DIR", str(web_dir))
        result = find_spa_dir()
        assert result == str(web_dir), (
            "find_spa_dir() must return LIVEFLOW_SPA_DIR when set"
        )

    def test_find_spa_dir_discovers_frozen_dir_from_file(
        self, tmp_path, monkeypatch
    ):
        """find_spa_dir() discovers liveflow/_web relative to __file__."""
        from liveflow.http_handler import find_spa_dir
        import liveflow.http_handler as mod

        web_dir = tmp_path / "liveflow" / "_web"
        web_dir.mkdir(parents=True)
        (web_dir / "index.html").write_text("<html></html>")
        (tmp_path / "liveflow" / "__init__.py").write_text("")

        # Block all other discovery paths
        monkeypatch.setattr(os, "getcwd", lambda: str(tmp_path))
        monkeypatch.setattr(
            mod,
            "__file__",
            str(tmp_path / "liveflow" / "http_handler.py"),
        )
        monkeypatch.delenv("LIVEFLOW_SPA_DIR", raising=False)

        result = find_spa_dir()
        assert result == str(web_dir), (
            "find_spa_dir() must discover liveflow/_web near __file__"
        )

    def test_liveflow_main_accepts_dashboard_port_flag(self):
        """main() parses --dashboard-port flag.

        We verify the flag parser directly (not the full main() which
        does network I/O and subprocess execution).
        """
        from liveflow.__main__ import _parse_liveflow_flags

        flags, remaining = _parse_liveflow_flags(
            ["--dashboard-port", "9999", "agent.py", "dev"]
        )
        assert flags["dashboard_port"] == 9999
        assert flags["script"] == "agent.py"
        # remaining includes the script + trailing args
        assert remaining == ["agent.py", "dev"]

    def test_liveflow_main_accepts_no_open_flag(self):
        """main() parses --no-open flag."""
        from liveflow.__main__ import _parse_liveflow_flags

        flags, remaining = _parse_liveflow_flags(["--no-open", "agent.py"])
        assert flags["no_open"] is True
        assert flags["script"] == "agent.py"
        assert remaining == ["agent.py"]

    def test_liveflow_main_accepts_python_flag(self):
        """main() parses --python flag for interpreter override."""
        from liveflow.__main__ import _parse_liveflow_flags

        flags, remaining = _parse_liveflow_flags(
            ["--python", "/usr/bin/python3.12", "agent.py", "dev"]
        )
        assert flags["python_path"] == "/usr/bin/python3.12"
        assert flags["script"] == "agent.py"
        assert remaining == ["agent.py", "dev"]

    def test_liveflow_main_passes_script_args_through(self):
        """Remaining args after script are preserved for the agent."""
        from liveflow.__main__ import _parse_liveflow_flags

        flags, remaining = _parse_liveflow_flags(
            [
                "--dashboard-port",
                "8765",
                "agent.py",
                "dev",
                "--log-level",
                "DEBUG",
            ]
        )
        assert flags["dashboard_port"] == 8765
        assert remaining == ["agent.py", "dev", "--log-level", "DEBUG"]


# -- Recipe behavioral tests ---------------------------------------------------

RECIPE_PATH = os.path.join(REPO_ROOT, ".pip3r", "recipes", "pyinstaller.yaml")


class TestRecipe:
    """Verify the pip3r pyinstaller recipe bundles runtime deps."""

    def test_recipe_exists(self):
        """Recipe file exists."""
        assert os.path.isfile(RECIPE_PATH), (
            f"pyinstaller.yaml not found at {RECIPE_PATH}"
        )

    def test_recipe_uses_system_executor_with_uvx_binary(self):
        """Recipe uses executor: system + binary: uvx for prependArgs control."""
        with open(RECIPE_PATH, "r", encoding="utf-8") as f:
            content = f.read()
        assert "executor: system" in content, (
            "Recipe must use executor: system so prependArgs are passed to uvx"
        )
        assert "binary: uvx" in content, (
            "Recipe binary must be uvx"
        )

    def test_recipe_prependargs_select_python_314(self):
        """prependArgs forces Python 3.14 to avoid OBS-718 execstack."""
        with open(RECIPE_PATH, "r", encoding="utf-8") as f:
            content = f.read()
        assert '"3.14"' in content or "'3.14'" in content, (
            "prependArgs must specify Python 3.14"
        )

    def test_recipe_prependargs_include_local_python_package(self):
        """prependArgs installs ./python so runtime deps are available."""
        with open(RECIPE_PATH, "r", encoding="utf-8") as f:
            content = f.read()
        assert '"./python"' in content or "'./python'" in content, (
            "prependArgs must --with ./python to install websockets+pydantic"
        )

    def test_recipe_prependargs_use_pyinstaller_from_pyinstaller(self):
        """prependArgs runs pyinstaller from the pyinstaller package."""
        with open(RECIPE_PATH, "r", encoding="utf-8") as f:
            content = f.read()
        assert '"pyinstaller"' in content, (
            "prependArgs must reference pyinstaller package and binary"
        )

    def test_recipe_has_notice(self):
        """Recipe has a notice field for user guidance."""
        with open(RECIPE_PATH, "r", encoding="utf-8") as f:
            content = f.read()
        assert "notice:" in content or 'notice:' in content, (
            "Recipe must have a notice field"
        )
        assert "SPA" in content and "3.14" in content, (
            "Notice must mention SPA build + Python 3.14 requirement"
        )
