import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    filename: str
    mime: str
    size: int
    pages: int | None
    ocr_used: bool


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    title: str
    summary: str | None
    category: str | None
    doc_type: str | None
    doc_date: date | None
    expires_on: date | None
    year: int | None
    tags: list[str]
    status: str
    error: str | None
    created_at: datetime
    document: DocumentOut | None


class ItemDetail(ItemOut):
    entities: dict
    text: str | None = None


class ItemList(BaseModel):
    items: list[ItemOut]
    total: int


class ItemUpdate(BaseModel):
    title: str | None = None
    category: str | None = None
    doc_type: str | None = None
    doc_date: date | None = None
    expires_on: date | None = None
    year: int | None = None
    tags: list[str] | None = None
    summary: str | None = None


class UploadResult(BaseModel):
    created: list[ItemOut]
    duplicates: list[str]


class SearchHit(BaseModel):
    item: ItemOut
    score: float
    snippet: str
    matched_by: list[str]


class SearchResponse(BaseModel):
    query: str
    text: str
    years: list[int]
    hits: list[SearchHit]


class AskRequest(BaseModel):
    question: str


class AskSource(BaseModel):
    n: int
    item_id: str
    title: str
    category: str | None
    year: int | None


class AskResponse(BaseModel):
    answer: str
    sources: list[AskSource]


class LoginRequest(BaseModel):
    password: str


class FacetCount(BaseModel):
    value: str
    count: int


class Stats(BaseModel):
    total: int
    pending: int
    errors: int
    categories: list[FacetCount]
    years: list[FacetCount]
    expiring: list[ItemOut]
