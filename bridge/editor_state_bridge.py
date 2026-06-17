from __future__ import annotations

import json

from config import get_editor_state_path


def save_editor_state(session_id: str, state: dict) -> dict:
    try:
        session_id = str(session_id or "").strip()
        if not session_id:
            return {"ok": False, "error": "No session ID"}

        path = get_editor_state_path(session_id)
        path.parent.mkdir(parents=True, exist_ok=True)

        payload = {
            "session_id": session_id,
            "version": 1,
            "state": state or {},
        }

        path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        return {"ok": True, "path": str(path)}

    except Exception as e:
        return {"ok": False, "error": str(e)}


def load_editor_state(session_id: str) -> dict:
    try:
        session_id = str(session_id or "").strip()
        if not session_id:
            return {"ok": False, "error": "No session ID"}

        path = get_editor_state_path(session_id)
        if not path.exists():
            return {"ok": True, "exists": False, "state": None}

        payload = json.loads(path.read_text(encoding="utf-8"))
        return {
            "ok": True,
            "exists": True,
            "state": payload.get("state", {}),
            "path": str(path),
        }

    except Exception as e:
        return {"ok": False, "error": str(e)}