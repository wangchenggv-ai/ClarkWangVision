"""Pydantic schemas for platform users."""

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.schemas.center import CenterResponse

RoleType = Literal["admin", "doctor", "viewer"]


class UserCreate(BaseModel):
    """Payload for POST /users — admin only."""

    username: str = Field(..., min_length=3, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=8, description="Plain-text password; will be hashed")
    full_name: Optional[str] = Field(None, max_length=100)
    role: RoleType
    center_id: Optional[int] = Field(
        None, description="Required for doctor / viewer; null for admin"
    )


class UserUpdate(BaseModel):
    """Payload for PATCH /users/{id}.

    Role changes are intentionally excluded here — role elevation must go
    through a dedicated endpoint with stricter authorization.
    """

    email: Optional[EmailStr] = None
    full_name: Optional[str] = Field(None, max_length=100)
    center_id: Optional[int] = None
    is_active: Optional[bool] = None
    password: Optional[str] = Field(None, min_length=8, description="New plain-text password")


class UserResponse(BaseModel):
    """User representation returned to API clients (no password hash)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: str
    full_name: Optional[str]
    role: str
    center_id: Optional[int]
    is_active: bool
    created_at: datetime
    last_login: Optional[datetime] = None


class UserWithCenter(UserResponse):
    """Extended user response that embeds the associated center object."""

    center: Optional[CenterResponse] = None
