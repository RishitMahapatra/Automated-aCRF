"""
app.py
======
Entry point — creates the PyWebView window and exposes the Python API.
Run with: python app.py
"""

import sys
import threading
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
        """Intercept window close; show a JS save dialog if the session is dirty.

        IMPORTANT: evaluate_js() dispatches to the UI/main thread.  The closing
        event itself fires on the UI thread, so calling evaluate_js() here would
        deadlock — the UI thread would wait for itself.  Fixes:
          1. Dirty state is mirrored to api._is_dirty by JS (no evaluate_js needed
             for the check).
          2. The dialog is shown from a *background thread* so this handler can
             return False immediately without blocking.
        """
        if not api._is_dirty:
            return True  # nothing to save — let the window close

        def _show_dialog():
            try:
                window.evaluate_js(
                    'typeof window._showCloseDialog === "function" && window._showCloseDialog()'
                )
            except Exception as e:
                print(f"[closing] evaluate_js error: {e}")

        threading.Thread(target=_show_dialog, daemon=True).start()
        return False  # cancel native close; JS dialog calls api.confirm_close()

    window.events.closing += on_closing

    webview.start(debug=True)


if __name__ == "__main__":
    main()