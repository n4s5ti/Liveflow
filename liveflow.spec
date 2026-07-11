# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for Liveflow — produces a single-file executable.

Usage:
  1. Build the webview SPA first:  npm run build -w @liveflow/webview
  2. Run PyInstaller:              pip3r pyinstaller --noconfirm --clean liveflow.spec
  3. Output at:                    dist/liveflow

Design:
  - Analysis starts from the thin _frozen_entry.py shim.
  - All liveflow package modules are collected transitively from imports.
  - The webview SPA (packages/webview/dist/*) is bundled as data files
    under `liveflow/_web/` inside the frozen archive.
  - The frozen executable's bootloader extracts data to sys._MEIPASS;
    _frozen_entry.py sets LIVEFLOW_SPA_DIR so find_spa_dir() discovers it.
  - The frozen executable does NOT bundle a project interpreter — it
    delegates agent execution to the interpreter resolved at runtime
    (--python > VIRTUAL_ENV > PATH).
  - Console is enabled: liveflow is a CLI tool.
"""

import os

# -- Project root (where this .spec file lives) ---------------------------------
spec_root = SPECPATH  # provided by PyInstaller

# -- Webview data files ---------------------------------------------------------
# The SPA lives at packages/webview/dist relative to the repo root.
# PyInstaller `datas` tuples: (source_path, dest_dir_inside_bundle)
webview_dist = os.path.join(spec_root, "packages", "webview", "dist")

datas = []
if os.path.isdir(webview_dist):
    datas.append((webview_dist, "liveflow/_web"))
else:
    print(f"WARNING: webview dist not found at {webview_dist} — build it first with:")
    print(f"         npm run build -w @liveflow/webview")
    print(f"  Continuing without bundled SPA; the frozen exe will serve nothing.")

# -- Hidden imports -------------------------------------------------------------
# PyInstaller's static analysis may miss these:
#   - websockets: loaded dynamically by ws_server
#   - pydantic: Pydantic may need specific sub-modules for validators
#   - asyncio: event-loop dependent (added by default in modern PyInstaller)
hiddenimports = [
    "websockets",
    "websockets.server",
    "websockets.asyncio.server",
    "pydantic",
]

# -- Exclusions -----------------------------------------------------------------
# Don't bundle these if they get sucked in transitively
excludes = [
    "tkinter",
    "test",
    "unittest",
    "pytest",
    "_pytest",
    "coverage",
]

# -- Collect everything ---------------------------------------------------------
# Add python/ to the analysis path so PyInstaller can find the `liveflow` package
a = Analysis(
    [os.path.join(spec_root, "python", "liveflow", "_frozen_entry.py")],
    pathex=[os.path.join(spec_root, "python")],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="liveflow",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)


