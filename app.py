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

    def on_closing():
        """Intercept window close; show a JS save dialog if the session is dirty."""
        try:
            is_dirty = window.evaluate_js(
                'typeof window._isSessionDirty === "function" && window._isSessionDirty() === true'
            )
            if not is_dirty:
                return True  # nothing to save — allow close immediately
            # Show the custom JS close-confirm dialog and cancel the native close.
            # The dialog's "Save & Close" / "Discard & Close" buttons will call
            # api.confirm_close() which destroys the window.
            window.evaluate_js(
                'typeof window._showCloseDialog === "function" && window._showCloseDialog()'
            )
            return False  # cancel native close; JS dialog takes over
        except Exception:
            return True  # if JS check fails just allow close

    window.events.closing += on_closing

    webview.start(debug=True)


if __name__ == "__main__":
    main()