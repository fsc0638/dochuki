import sys
from pathlib import Path

import pytest

# 讓 `app` package 在任何工作目錄下呼叫 pytest 都能被 import 到,
# 不依賴呼叫端剛好在 services/ocr-sidecar/ 底下執行
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.schema import OcrLine

Y_STEP = 10.0


def build_lines(entries: list[tuple[str, float]]) -> list[OcrLine]:
    return [
        OcrLine(text=text, confidence=confidence, y=i * Y_STEP)
        for i, (text, confidence) in enumerate(entries)
    ]


@pytest.fixture
def make_lines():
    return build_lines
