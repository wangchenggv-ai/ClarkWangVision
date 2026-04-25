"""Pydantic schemas for research centers."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class CenterBase(BaseModel):
    """Fields shared by create / update / response schemas."""

    name: str = Field(..., max_length=200, description="Unique center name")
    city: Optional[str] = Field(None, max_length=100)
    contact_name: Optional[str] = Field(None, max_length=100)
    contact_phone: Optional[str] = Field(None, max_length=50)


class CenterCreate(CenterBase):
    """Payload for POST /centers."""

    pass


class CenterUpdate(BaseModel):
    """Payload for PATCH /centers/{id} — every field is optional."""

    name: Optional[str] = Field(None, max_length=200)
    city: Optional[str] = Field(None, max_length=100)
    contact_name: Optional[str] = Field(None, max_length=100)
    contact_phone: Optional[str] = Field(None, max_length=50)
    is_active: Optional[bool] = None


class CenterResponse(CenterBase):
    """Center representation returned to API clients."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    is_active: bool
    created_at: datetime
