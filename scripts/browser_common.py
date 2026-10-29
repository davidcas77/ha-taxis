"""Shared setup for the scripts/*-browser.py scenarios.

Nothing here is specific to one machine: the app address comes from
TAXIS_TEST_URL, the browser from CHROMIUM_PATH (Playwright's own Chromium when
unset), and files the scenarios write go to TAXIS_SCREENSHOT_DIR or a fresh
temporary directory. Paths are derived from this file's location, never from a
fixed checkout directory.

Start the fake Home Assistant and a built Taxis first, for example:
  npm run build
  MOCK_HA_PORT=8134 npx tsx scripts/mock-ha.ts &
  HA_URL=http://localhost:8134 HA_TOKEN=mock PORT=8109 TAXIS_DATA_DIR=$(mktemp -d) node dist/server.js &
  TAXIS_TEST_URL=http://localhost:8109 python3 scripts/browser-regression.py
"""
import os
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get("TAXIS_TEST_URL", "http://localhost:8099")

_shots = None


def screenshot_dir() -> Path:
    """Where screenshots go: TAXIS_SCREENSHOT_DIR, else one temporary directory per run."""
    global _shots
    if _shots is None:
        configured = os.environ.get("TAXIS_SCREENSHOT_DIR")
        _shots = Path(configured) if configured else Path(tempfile.mkdtemp(prefix="taxis-shots-"))
        _shots.mkdir(parents=True, exist_ok=True)
    return _shots


def launch(playwright, **options):
    """Start Chromium: CHROMIUM_PATH when set, otherwise the browser Playwright installed."""
    executable = os.environ.get("CHROMIUM_PATH")
    if executable:
        options["executable_path"] = executable
    options.setdefault("headless", True)
    options.setdefault("args", ["--no-sandbox"])
    return playwright.chromium.launch(**options)
