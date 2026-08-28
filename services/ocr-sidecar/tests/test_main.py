from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.schema import OcrLine

client = TestClient(app)


def test_health_returns_ok():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_extract_assembles_fields_from_mocked_ocr():
    fake_lines = [
        OcrLine(text="タクシー", confidence=0.9, y=0.0),
        OcrLine(text="合計 ¥1,200", confidence=0.9, y=10.0),
    ]
    with patch("app.main.run_ocr", return_value=fake_lines):
        response = client.post(
            "/extract",
            files={"image": ("receipt.png", b"fake-image-bytes", "image/png")},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["fields"]["total"]["value"] == 1200.0
    assert body["fields"]["currency"]["value"] == "JPY"
    assert body["classification"]["type"] == "single_charge"


def test_extract_returns_400_when_ocr_raises():
    with patch("app.main.run_ocr", side_effect=ValueError("corrupt image")):
        response = client.post(
            "/extract",
            files={"image": ("bad.png", b"not-an-image", "image/png")},
        )
    assert response.status_code == 400
    assert "error" in response.json()


def test_extract_with_empty_ocr_result_returns_all_null_fields():
    with patch("app.main.run_ocr", return_value=[]):
        response = client.post(
            "/extract",
            files={"image": ("blank.png", b"fake-image-bytes", "image/png")},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["ocr_confidence_mean"] == 0.0
    assert body["fields"]["total"]["value"] is None
    assert body["classification"]["type"] == "unknown"
