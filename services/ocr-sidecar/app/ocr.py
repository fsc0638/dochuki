"""包裝 RapidOCR。模型在 import 期一次載入,讓 /health 回 200 代表「真的能推論」而非「process 起來了」。"""

from rapidocr_onnxruntime import RapidOCR

from app.schema import OcrLine

_engine = RapidOCR()


def run_ocr(image_bytes: bytes) -> list[OcrLine]:
    result, _elapsed = _engine(image_bytes)
    lines = []
    if result:
        for bbox, text, confidence in result:
            y = sum(point[1] for point in bbox) / len(bbox) if bbox else 0.0
            lines.append(OcrLine(text=text, confidence=confidence, y=y))
    lines.sort(key=lambda line: line.y)
    return lines
