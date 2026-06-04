"""Pipeline package."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from .crf_full_pipeline import run_pipeline, load_mapping
from .crf_annotator import run_annotator

__all__ = ["run_pipeline", "load_mapping", "run_annotator"]