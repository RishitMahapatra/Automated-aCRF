"""
app.py
======
Entry point — creates the PyWebView window and exposes the Python API.
Run with: python app.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).parent.resolve()
sys.path.insert(0, str(ROOT))

import webview
from api import Api
from config import UI_DIR


def main():
    api = Api()

    window = webview.create_window(
        title="CRF Annotation Editor",
        url=str(UI_DIR / "index.html"),
        js_api=api,
        width=1440,
        height=900,
        min_size=(1024, 700),
        resizable=True,
        frameless=False,
        easy_drag=False,
        text_select=False,
    )

    # Store window reference so API can call evaluate_js
    api._window = window

    webview.start(debug=True)


if __name__ == "__main__":
    main()