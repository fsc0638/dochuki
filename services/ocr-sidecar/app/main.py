from fastapi import FastAPI, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from app.ocr import run_ocr
from app.rules.classify import classify_charge_type
from app.rules.currency import extract_currency
from app.rules.datetime_rule import extract_datetime
from app.rules.store import extract_store
from app.rules.tax import extract_tax
from app.rules.total import extract_total
from app.schema import ExtractResponse

app = FastAPI(title="dochuki-ocr-sidecar")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/extract", response_model=ExtractResponse)
async def extract(image: UploadFile) -> dict | JSONResponse:
    image_bytes = await image.read()

    try:
        # run_ocr 是同步、CPU-bound 的呼叫（ONNX 推論）——FastAPI 只會自動把
        # 「def」路由丟到 threadpool，這支是 async def，直接呼叫會卡住唯一的
        # 事件迴圈，連同時進來的 /health 健康檢查都會被卡住逾時（對抗式審查
        # 抓到的問題：uvicorn 預設單一 worker，健康檢查逾時只有 5 秒）。用
        # run_in_threadpool 讓推論真的在背景執行緒跑，不擋住事件迴圈
        lines = await run_in_threadpool(run_ocr, image_bytes)

        raw_text = "\n".join(line.text for line in lines)
        ocr_confidence_mean = (
            sum(line.confidence for line in lines) / len(lines) if lines else 0.0
        )

        return {
            "raw_text": raw_text,
            "ocr_confidence_mean": ocr_confidence_mean,
            "fields": {
                "store": extract_store(lines),
                "datetime": extract_datetime(lines),
                "currency": extract_currency(raw_text),
                "total": extract_total(lines),
                "tax": extract_tax(lines),
            },
            "classification": classify_charge_type(lines),
        }
    except Exception as exc:
        # 涵蓋範圍不只 run_ocr——下面組裝回應的規則函式若未來改動時意外拋出，
        # 也該回一致的 400 錯誤形狀，而不是讓 FastAPI 預設中介層轉成不透明的
        # 500（對抗式審查抓到原本 try/except 只包 run_ocr 這一段的缺口）
        return JSONResponse(status_code=400, content={"error": str(exc)})
