"""
Thin entry point for the PyInstaller onefile frozen executable.

This module is the Analysis entry for PyInstaller. The bootloader runs it
as the first Python code inside the frozen process. It detects frozen mode,
sets up bundled-asset discovery, and delegates to the real CLI entry point.

Design notes:
  - LIVEFLOW_SPA_DIR tells find_spa_dir() where the SPA lives.
    In frozen mode this is `sys._MEIPASS/liveflow/_web` (the bundled
    packages/webview/dist). In source mode the server discovers
    `packages/webview/dist` relative to the repo root.
  - The frozen executable does NOT bundle a Python interpreter for the
    user's agent script. It delegates to the project interpreter resolved
    by `__main__.main()`: --python > VIRTUAL_ENV > PATH.
  - PyInstaller's bootloader sets `sys.frozen = True` and `sys._MEIPASS`
    to the temporary extraction directory.
"""

import os
import sys

if getattr(sys, "frozen", False):
    _meipass = getattr(sys, "_MEIPASS", None)
    if _meipass:
        _web_dir = os.path.join(_meipass, "liveflow", "_web")
        if os.path.isdir(_web_dir):
            os.environ["LIVEFLOW_SPA_DIR"] = _web_dir

# PyInstaller's Analysis phase follows this import to discover the
# liveflow package transitively. At execution time the import resolves
# normally through the frozen sys.path.
from liveflow.__main__ import main

if __name__ == "__main__":
    main()
