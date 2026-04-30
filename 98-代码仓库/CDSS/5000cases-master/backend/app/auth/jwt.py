"""JWT utilities: token creation, verification, and password hashing."""

from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from app.config import settings

# ---------------------------------------------------------------------------
# Password hashing context (bcrypt)
# ---------------------------------------------------------------------------
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ---------------------------------------------------------------------------
# Token payload schema
# ---------------------------------------------------------------------------
class TokenData(BaseModel):
    user_id: int
    role: str
    center_id: Optional[int] = None


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------

def get_password_hash(password: str) -> str:
    """Return a bcrypt hash of *password*."""
    return _pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    """Return True if *plain* matches the stored *hashed* password."""
    return _pwd_context.verify(plain, hashed)


# ---------------------------------------------------------------------------
# Token creation
# ---------------------------------------------------------------------------

def create_access_token(data: dict) -> str:
    """Create a short-lived JWT access token.

    *data* must contain ``user_id``, ``role``, and optionally ``center_id``.
    Expiry is controlled by ``settings.ACCESS_TOKEN_EXPIRE_MINUTES``.
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict) -> str:
    """Create a long-lived JWT refresh token.

    Expiry is controlled by ``settings.REFRESH_TOKEN_EXPIRE_DAYS``.
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS
    )
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


# ---------------------------------------------------------------------------
# Token verification
# ---------------------------------------------------------------------------

def verify_token(token: str, expected_type: str = "access") -> TokenData:
    """Decode and validate a JWT.

    Raises ``JWTError`` (which callers should map to HTTP 401) on any failure.

    Args:
        token: Raw JWT string.
        expected_type: ``"access"`` or ``"refresh"`` — the ``type`` claim
            embedded in the token must match.

    Returns:
        :class:`TokenData` containing ``user_id``, ``role``, and
        ``center_id``.
    """
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])

    token_type: Optional[str] = payload.get("type")
    if token_type != expected_type:
        raise JWTError(f"Expected token type '{expected_type}', got '{token_type}'")

    user_id: Optional[int] = payload.get("user_id")
    role: Optional[str] = payload.get("role")
    if user_id is None or role is None:
        raise JWTError("Token payload missing required fields")

    return TokenData(
        user_id=user_id,
        role=role,
        center_id=payload.get("center_id"),
    )
