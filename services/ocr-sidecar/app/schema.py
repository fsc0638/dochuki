"""共用型別。放在 leaf module 避免 rules/*.py 與 ocr.py 互相 import 造成循環。"""

from typing import Literal

from pydantic import BaseModel


class OcrLine(BaseModel):
    text: str
    confidence: float
    y: float


class StoreField(BaseModel):
    value: str | None
    confidence: float


class DatetimeField(BaseModel):
    value: str | None
    confidence: float


class CurrencyField(BaseModel):
    value: str | None
    confidence: float


class TotalField(BaseModel):
    value: float | None
    confidence: float


class TaxEntry(BaseModel):
    rate: float
    amount: float | None
    mode: Literal["內稅(税込)", "外稅(税抜)"] | None


class TaxField(BaseModel):
    value: list[TaxEntry]
    confidence: float


class Fields(BaseModel):
    store: StoreField
    datetime: DatetimeField
    currency: CurrencyField
    total: TotalField
    tax: TaxField


class Classification(BaseModel):
    type: Literal["single_charge", "itemized", "unknown"]
    confidence: float
    price_token_count: int


class ExtractResponse(BaseModel):
    raw_text: str
    ocr_confidence_mean: float
    fields: Fields
    classification: Classification
