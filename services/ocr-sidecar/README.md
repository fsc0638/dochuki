# ocr-sidecar

日文收據 OCR（RapidOCR/ONNX）＋ regex 規則層欄位擷取，供道中記主服務呼叫。

## 本機開發

```bash
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

`requirements.txt` 只列 production 執行期需要的套件（Dockerfile 只裝這份）；
`requirements-dev.txt` 額外含 pytest／httpx，本機開發／跑測試用這份。

## 跑測試

```bash
pytest
```

## 部署備註

本服務預設**不對外開 host port**——`docker-compose.yml` 只讓 Next.js 主服務透過
compose 內部網路呼叫，不直接暴露給宿主機。單獨測試本服務時,兩個選擇：

1. 用上面的 `uvicorn app.main:app --reload` 直接本機跑（免容器）
2. 或暫時在 `docker-compose.yml` 幫這個服務加一段 `ports: ["8000:8000"]` override
