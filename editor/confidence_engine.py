"""
editor/confidence_engine.py
============================
TF-IDF suggestion engine for RAW → SDTM mapping suggestions.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


# =============================================================================
# CANDIDATE DATACLASS
# =============================================================================

@dataclass
class SuggestionCandidate:
    raw_variable: str
    sdtm_dataset: str
    sdtm_variable: str
    sdtm_label: str
    score: float
    score_pct: int
    source_domain: str

    def to_dict(self) -> dict:
        return {
            "raw_variable": self.raw_variable,
            "sdtm_dataset": self.sdtm_dataset,
            "sdtm_variable": self.sdtm_variable,
            "sdtm_label": self.sdtm_label,
            "score": self.score,
            "score_pct": self.score_pct,
            "source_domain": self.source_domain,
        }


# =============================================================================
# CONFIDENCE ENGINE
# =============================================================================

class ConfidenceEngine:
    """
    TF-IDF based suggestion engine for RAW variable names.
    """

    def __init__(self):
        self._vectorizer: TfidfVectorizer | None = None
        self._matrix = None
        self._corpus: list[dict] = []
        self._is_built: bool = False

    # =========================================================================
    # BUILD FROM NORMALIZED MAPPING
    # =========================================================================

    def build_from_mapping(self, mapping: dict) -> int:
        """
        mapping format:
            {(domain, raw_variable): {
                "sdtm_dataset": ...,
                "sdtm_variable": ...,
                "sdtm_label": ...
            }}
        """
        self._corpus = []

        for (domain, raw_var), sdtm_info in mapping.items():
            if not raw_var or not isinstance(raw_var, str):
                continue

            raw_var = raw_var.strip().upper()
            if not raw_var:
                continue

            self._corpus.append({
                "raw_variable": raw_var,
                "sdtm_dataset": str(sdtm_info.get("sdtm_dataset", "") or "").strip().upper(),
                "sdtm_variable": str(sdtm_info.get("sdtm_variable", "") or "").strip().upper(),
                "sdtm_label": str(sdtm_info.get("sdtm_label", "") or "").strip(),
                "source_domain": str(domain or "").strip().upper(),
            })

        if not self._corpus:
            self._vectorizer = None
            self._matrix = None
            self._is_built = False
            return 0

        self._vectorizer = TfidfVectorizer(
            analyzer="char_wb",
            ngram_range=(2, 4),
            lowercase=True,
            min_df=1,
            sublinear_tf=True,
        )

        raw_names = [entry["raw_variable"] for entry in self._corpus]
        self._matrix = self._vectorizer.fit_transform(raw_names)
        self._is_built = True

        return len(self._corpus)

    # =========================================================================
    # BUILD FROM EXCEL
    # =========================================================================

    def build_from_excel(self, excel_path: str | Path) -> int:
        """
        Build corpus from the mapping Excel.
        Delegates to the pipeline's load_mapping() so both use identical
        parsing logic — fixes, column-lookup improvements, and separator
        handling are applied automatically.
        """
        import sys
        from pathlib import Path as _Path
        sys.path.insert(0, str(_Path(__file__).parent.parent))
        from pipeline.crf_full_pipeline import load_mapping

        try:
            mapping = load_mapping(excel_path)
        except Exception as e:
            print(f"[confidence_engine] Failed to load Excel mapping: {e}")
            return 0

        return self.build_from_mapping(mapping)

    # =========================================================================
    # QUERY
    # =========================================================================

    def get_candidates(
        self,
        raw_variable: str,
        top_n: int = 4,
        min_score: float = 0.05,
        domain_hint: str | None = None,
    ) -> list[SuggestionCandidate]:
        if not self._is_built or not self._vectorizer or self._matrix is None:
            return []

        query = str(raw_variable or "").strip().upper()
        if not query:
            return []

        query_vec = self._vectorizer.transform([query])
        sims = cosine_similarity(query_vec, self._matrix).flatten()

        if domain_hint:
            hint = str(domain_hint or "").strip().upper()
            for i, entry in enumerate(self._corpus):
                if entry["source_domain"] == hint:
                    sims[i] = min(1.0, sims[i] * 1.20)

        top_indices = np.argsort(sims)[::-1]

        candidates = []
        seen_vars = set()

        for idx in top_indices:
            score = float(sims[idx])
            if score < min_score:
                break

            entry = self._corpus[idx]
            sdtm_var = entry["sdtm_variable"]

            if sdtm_var in seen_vars:
                continue
            seen_vars.add(sdtm_var)

            candidates.append(
                SuggestionCandidate(
                    raw_variable=entry["raw_variable"],
                    sdtm_dataset=entry["sdtm_dataset"],
                    sdtm_variable=sdtm_var,
                    sdtm_label=entry["sdtm_label"],
                    score=round(score, 4),
                    score_pct=int(score * 100),
                    source_domain=entry["source_domain"],
                )
            )

            if len(candidates) >= top_n:
                break

        return candidates

    def get_candidates_multi(
        self,
        raw_variables: list[str],
        top_n: int = 4,
        min_score: float = 0.05,
    ) -> dict[str, list[SuggestionCandidate]]:
        if not self._is_built or not self._vectorizer or self._matrix is None:
            return {}

        if not raw_variables:
            return {}

        queries = [str(v or "").strip().upper() for v in raw_variables if str(v or "").strip()]
        if not queries:
            return {}

        query_vecs = self._vectorizer.transform(queries)
        sims_matrix = cosine_similarity(query_vecs, self._matrix)

        results = {}
        for q_idx, query in enumerate(queries):
            sims = sims_matrix[q_idx]
            top_indices = np.argsort(sims)[::-1]

            candidates = []
            seen_vars = set()

            for idx in top_indices:
                score = float(sims[idx])
                if score < min_score:
                    break

                entry = self._corpus[idx]
                sdtm_var = entry["sdtm_variable"]

                if sdtm_var in seen_vars:
                    continue
                seen_vars.add(sdtm_var)

                candidates.append(
                    SuggestionCandidate(
                        raw_variable=entry["raw_variable"],
                        sdtm_dataset=entry["sdtm_dataset"],
                        sdtm_variable=sdtm_var,
                        sdtm_label=entry["sdtm_label"],
                        score=round(score, 4),
                        score_pct=int(score * 100),
                        source_domain=entry["source_domain"],
                    )
                )

                if len(candidates) >= top_n:
                    break

            results[query] = candidates

        return results

    # =========================================================================
    # STATS
    # =========================================================================

    def corpus_stats(self) -> dict:
        if not self._is_built:
            return {"built": False}

        domains = {}
        for entry in self._corpus:
            d = entry["source_domain"]
            domains[d] = domains.get(d, 0) + 1

        return {
            "built": True,
            "total_entries": len(self._corpus),
            "unique_domains": len(domains),
            "domain_counts": domains,
            "vocab_size": len(self._vectorizer.vocabulary_) if self._vectorizer else 0,
        }