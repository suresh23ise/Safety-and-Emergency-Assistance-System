"""Safety & Emergency Assistance System launcher.

Usage:
    python run.py            # http://localhost:8000
    python run.py --port 9000
"""
from __future__ import annotations

import argparse
import os
import sys
import webbrowser
from pathlib import Path
from threading import Timer

import uvicorn

ROOT = Path(__file__).resolve().parent


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Safety & Emergency Assistance System server")
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    url = f"http://{args.host}:{args.port}"
    print(f"\n  Safety & Emergency Assistance System  ->  {url}\n")
    if not args.no_browser:
        Timer(1.2, lambda: webbrowser.open(url)).start()

    os.chdir(ROOT)
    uvicorn.run("server.main:app", host=args.host, port=args.port, reload=args.reload, log_level="info")


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))
    main()
