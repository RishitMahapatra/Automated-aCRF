"""
editor/edit_popup.py
=====================
Module 6 — Edit Popup

Provides the annotation editing interface rendered as a
Streamlit sidebar/panel. Opens when a user either:
  - Clicks an existing annotation box (RESOLVED or UNMAPPED)
  - Selects an unplaced component from the sidebar list

Workflow:
  1. Receives the clicked annotation_id from canvas_overlay
  2. Loads current record from annotation_store
  3. Queries confidence_engine for top-4 TF-IDF candidates
     using the form_code as domain hint
  4. Renders suggestion cards + manual override fields
  5. On confirm — calls store.mark_corrected() and returns
     the updated annotation_id for canvas redraw

Dependencies:
  editor/annotation_store.py
  editor/confidence_engine.py
No Tkinter dependency — pure Streamlit UI logic.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from editor.annotation_store  import AnnotationStore, AnnotationRecord
from editor.confidence_engine import ConfidenceEngine, SuggestionCandidate


# =============================================================================
# EDIT POPUP STATE
# =============================================================================

@dataclass
class PopupState:
    """
    Holds the current state of the edit popup.
    Stored in st.session_state between Streamlit reruns.

    Attributes
    ----------
    active          : whether the popup is currently open
    annotation_id   : ID of the record being edited
    candidates      : TF-IDF suggestion candidates
    selected_idx    : index of the selected candidate (-1 = manual)
    manual_dataset  : manually typed dataset override
    manual_variable : manually typed variable override
    manual_label    : manually typed label override
    is_unplaced     : whether this is an unplaced component
    """
    active:          bool                       = False
    annotation_id:   Optional[str]              = None
    candidates:      list[SuggestionCandidate]  = None
    selected_idx:    int                        = 0
    manual_dataset:  str                        = ""
    manual_variable: str                        = ""
    manual_label:    str                        = ""
    is_unplaced:     bool                       = False

    def __post_init__(self):
        if self.candidates is None:
            self.candidates = []


# =============================================================================
# EDIT POPUP CONTROLLER
# =============================================================================

class EditPopupController:
    """
    Controls the edit popup lifecycle.
    Manages state transitions and store updates.

    Usage (Streamlit)
    -----------------
    controller = EditPopupController(store, engine)

    # Open popup when user clicks a box
    controller.open(annotation_id, session_state)

    # Render popup in sidebar
    result = controller.render(session_state)

    # result is annotation_id if confirmed, None otherwise
    """

    def __init__(
        self,
        store:  AnnotationStore,
        engine: ConfidenceEngine,
        top_n:  int   = 4,
        min_score: float = 0.15,
    ):
        self._store     = store
        self._engine    = engine
        self._top_n     = top_n
        self._min_score = min_score

    # =========================================================================
    # OPEN / CLOSE
    # =========================================================================

    def open(
        self,
        annotation_id: str,
        state:         dict,
        is_unplaced:   bool = False,
    ) -> None:
        """
        Open the popup for a given annotation_id.
        Fetches TF-IDF candidates and initialises popup state.

        Parameters
        ----------
        annotation_id : ID of the annotation to edit
        state         : st.session_state dict
        is_unplaced   : True if this is an unplaced component
        """
        rec = self._store.get(annotation_id)
        if not rec:
            return

        # Get domain hint from form_code prefix
        domain_hint = self._extract_domain_hint(rec)

        # Query TF-IDF engine
        candidates = self._engine.get_candidates(
            raw_variable = rec.raw_variable or "",
            top_n        = self._top_n,
            min_score    = self._min_score,
            domain_hint  = domain_hint,
        )

        # Pre-fill manual fields with current values
        state["popup"] = PopupState(
            active          = True,
            annotation_id   = annotation_id,
            candidates      = candidates,
            selected_idx    = 0 if candidates else -1,
            manual_dataset  = rec.sdtm_dataset  or "",
            manual_variable = rec.sdtm_variable or "",
            manual_label    = rec.sdtm_label    or "",
            is_unplaced     = is_unplaced,
        )

    def close(self, state: dict) -> None:
        """Close the popup without saving."""
        state["popup"] = PopupState(active=False)

    def is_open(self, state: dict) -> bool:
        """Return True if popup is currently open."""
        popup = state.get("popup")
        return popup is not None and popup.active

    # =========================================================================
    # RENDER
    # =========================================================================

    def render(self, state: dict) -> Optional[str]:
        """
        Render the edit popup in the Streamlit sidebar.
        Must be called inside a `with st.sidebar:` block
        or directly in the main area.

        Parameters
        ----------
        state : st.session_state dict

        Returns
        -------
        annotation_id if user confirmed, None otherwise
        """
        import streamlit as st

        popup = state.get("popup")
        if not popup or not popup.active:
            return None

        rec = self._store.get(popup.annotation_id)
        if not rec:
            self.close(state)
            return None

        # ── Header ────────────────────────────────────────────────────
        st.markdown("---")
        st.markdown(
            f"### ✏️ Edit Annotation"
        )

        # Record info
        info_col1, info_col2 = st.columns(2)
        with info_col1:
            st.markdown(f"**Component:** `{rec.component}`")
            st.markdown(f"**Form:** `{rec.form_code}`")
        with info_col2:
            st.markdown(f"**RAW Variable:** `{rec.raw_variable or '—'}`")
            status_badge = {
                "RESOLVED":       "🔵 RESOLVED",
                "UNMAPPED":       "🔴 UNMAPPED",
                "USER_CORRECTED": "🟢 USER CORRECTED",
            }.get(rec.status, rec.status)
            st.markdown(f"**Status:** {status_badge}")

        st.markdown("---")

        # ── TF-IDF Suggestion Cards ───────────────────────────────────
        if popup.candidates:
            st.markdown("**🤖 TF-IDF Suggestions:**")
            st.caption(
                "Select a suggestion or enter manually below."
            )

            for i, cand in enumerate(popup.candidates):
                is_selected = (popup.selected_idx == i)

                # Score colour
                score_icon = (
                    "🟢" if cand.score_pct >= 70
                    else "🟡" if cand.score_pct >= 40
                    else "🔴"
                )

                # Card border style
                border_col = "#0072B2" if is_selected else "#cccccc"
                bg_col     = "#e8f4fd" if is_selected else "#f9f9f9"

                st.markdown(
                    f"""
                    <div style="
                        border: 2px solid {border_col};
                        border-radius: 6px;
                        padding: 8px 12px;
                        margin-bottom: 6px;
                        background: {bg_col};
                    ">
                        <span style="font-size:13px;">
                            {score_icon} <b>{cand.sdtm_dataset}.{cand.sdtm_variable}</b>
                            &nbsp;&nbsp;
                            <span style="color:#666; font-size:11px;">
                                {cand.score_pct}% match
                            </span>
                        </span>
                        <br/>
                        <span style="color:#444; font-size:11px;">
                            {cand.sdtm_label or '—'}
                        </span>
                        <br/>
                        <span style="color:#888; font-size:10px;">
                            RAW: {cand.raw_variable}
                            &nbsp;|&nbsp;
                            Domain: {cand.source_domain}
                        </span>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )

                if st.button(
                    f"Select #{i+1}",
                    key  = f"sel_{popup.annotation_id}_{i}",
                    type = "primary" if is_selected else "secondary",
                    use_container_width = True,
                ):
                    popup.selected_idx    = i
                    popup.manual_dataset  = cand.sdtm_dataset
                    popup.manual_variable = cand.sdtm_variable
                    popup.manual_label    = cand.sdtm_label or ""
                    state["popup"]        = popup
                    st.rerun()

        else:
            st.warning(
                "No TF-IDF candidates found above threshold. "
                "Please enter mapping manually."
            )
            popup.selected_idx = -1

        st.markdown("---")

        # ── Manual Override Fields ────────────────────────────────────
        st.markdown("**✍️ Manual Override / Confirm:**")

        # Pre-fill from selected candidate or current record
        if (popup.selected_idx >= 0
                and popup.selected_idx < len(popup.candidates)):
            cand = popup.candidates[popup.selected_idx]
            default_ds  = cand.sdtm_dataset
            default_var = cand.sdtm_variable
            default_lbl = cand.sdtm_label or ""
        else:
            default_ds  = popup.manual_dataset
            default_var = popup.manual_variable
            default_lbl = popup.manual_label

        import streamlit as st

        man_col1, man_col2 = st.columns(2)
        with man_col1:
            new_dataset = st.text_input(
                "SDTM Dataset",
                value = default_ds,
                key   = f"ds_{popup.annotation_id}",
            ).strip().upper()
        with man_col2:
            new_variable = st.text_input(
                "SDTM Variable",
                value = default_var,
                key   = f"var_{popup.annotation_id}",
            ).strip().upper()

        new_label = st.text_input(
            "SDTM Label (optional)",
            value = default_lbl,
            key   = f"lbl_{popup.annotation_id}",
        ).strip()

        # Update popup state with manual edits
        popup.manual_dataset  = new_dataset
        popup.manual_variable = new_variable
        popup.manual_label    = new_label
        state["popup"]        = popup

        st.markdown("---")

        # ── Action Buttons ────────────────────────────────────────────
        btn_col1, btn_col2, btn_col3 = st.columns(3)

        confirmed_id = None

        with btn_col1:
            if st.button(
                "✅ Confirm",
                key  = f"confirm_{popup.annotation_id}",
                type = "primary",
                use_container_width = True,
            ):
                if new_dataset and new_variable:
                    self._store.mark_corrected(
                        popup.annotation_id,
                        sdtm_dataset  = new_dataset,
                        sdtm_variable = new_variable,
                        sdtm_label    = new_label,
                    )
                    confirmed_id = popup.annotation_id
                    self.close(state)
                    st.success(
                        f"Saved: {new_dataset}.{new_variable} ✅"
                    )
                    st.rerun()
                else:
                    st.error(
                        "Dataset and Variable are required."
                    )

        with btn_col2:
            if st.button(
                "🗑️ Clear Mapping",
                key = f"clear_{popup.annotation_id}",
                use_container_width = True,
            ):
                self._store.update(
                    popup.annotation_id,
                    sdtm_dataset  = "",
                    sdtm_variable = "",
                    sdtm_label    = "",
                    status        = "UNMAPPED",
                )
                confirmed_id = popup.annotation_id
                self.close(state)
                st.rerun()

        with btn_col3:
            if st.button(
                "❌ Cancel",
                key = f"cancel_{popup.annotation_id}",
                use_container_width = True,
            ):
                self.close(state)
                st.rerun()

        return confirmed_id

    # =========================================================================
    # HELPERS
    # =========================================================================

    def _extract_domain_hint(self, rec: AnnotationRecord) -> str:
        """
        Extract domain hint from form_code or existing sdtm_dataset.
        e.g. form_code=CM01 → hint=CM
             form_code=AE01 → hint=AE
             form_code=SUPPCM01 → hint=CM
        """
        # Use existing dataset if already mapped
        if rec.sdtm_dataset:
            return rec.sdtm_dataset.strip().upper()

        # Extract from form_code prefix
        fc = (rec.form_code or "").strip().upper()
        if not fc:
            return ""

        # Strip trailing digits
        import re
        prefix = re.sub(r'\d+$', '', fc)

        # Handle SUPP prefixes — extract base domain
        if prefix.startswith("SUPP"):
            base = prefix[4:]
            return base if base else prefix

        return prefix