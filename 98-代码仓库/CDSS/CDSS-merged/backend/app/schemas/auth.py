"""Pydantic schemas for authentication and token handling."""

from typing import Optional

from pydantic import BaseModel, Field


class Token(BaseModel):
    """JWT token payload returned after a successful login."""

    access_token: str
    token_type: str = "bearer"
    refresh_token: Optional[str] = None


class TokenData(BaseModel):
    """Decoded claims stored inside a JWT.

    Populated by the auth dependency after validating the token signature.
    """

    user_id: Optional[int] = None
    role: Optional[str] = None
    center_id: Optional[int] = None


class LoginRequest(BaseModel):
    """Credentials submitted by a user at the /auth/login endpoint."""

    username: str = Field(..., min_length=1, description="Username or email")
    password: str = Field(..., min_length=1)
