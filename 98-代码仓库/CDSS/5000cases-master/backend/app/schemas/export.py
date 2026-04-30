"""Pydantic schemas for data export endpoints."""

from datetime import date
from typing import Optional

from pydantic import BaseModel, Field, model_validator


class ExportFilter(BaseModel):
    """Query parameters / request body used to scope a data export.

    All fields are optional; omitting them returns the full dataset
    (subject to the caller's center-level access permissions).
    """

    center_id: Optional[int] = Field(
        None, description="Limit export to a single research center"
    )
    start_date: Optional[date] = Field(
        None, description="Include records on or after this date (enrollment date)"
    )
    end_date: Optional[date] = Field(
        None, description="Include records on or before this date (enrollment date)"
    )

    @model_validator(mode="after")
    def validate_date_range(self) -> "ExportFilter":
        if self.start_date and self.end_date and self.start_date > self.end_date:
            raise ValueError("start_date must not be later than end_date")
        return self
