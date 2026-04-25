"""FastAPI dependency functions for authentication and role-based authorization."""

from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.auth.jwt import verify_token
from app.database import get_db
from app.models.user import User

# OAuth2 scheme — the login endpoint is at /api/auth/login
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


# ---------------------------------------------------------------------------
# Core dependency: resolve the current user from the Bearer token
# ---------------------------------------------------------------------------

def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Decode the JWT access token and return the corresponding active User.

    Raises HTTP 401 if the token is invalid, expired, or the user does not
    exist / has been deactivated.
    """
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="身份验证失败，请重新登录",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        token_data = verify_token(token, expected_type="access")
    except JWTError:
        raise credentials_exc

    user: Optional[User] = db.get(User, token_data.user_id)
    if user is None:
        raise credentials_exc
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="账号已被禁用，请联系管理员",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


# ---------------------------------------------------------------------------
# Role-based authorization dependencies
# ---------------------------------------------------------------------------

def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Allow only users with the 'admin' role.

    Raises HTTP 403 for any other role.
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="此操作仅限管理员",
        )
    return current_user


def require_doctor_or_admin(current_user: User = Depends(get_current_user)) -> User:
    """Allow 'admin' and 'doctor' roles; reject 'viewer'.

    Raises HTTP 403 for viewers.
    """
    if current_user.role == "viewer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只读账号无权执行此操作",
        )
    return current_user


# ---------------------------------------------------------------------------
# Center-scoping dependency
# ---------------------------------------------------------------------------

def get_center_filter(
    current_user: User = Depends(get_current_user),
) -> Optional[int]:
    """Return the center_id to use when filtering DB queries.

    - Admin users: returns ``None`` (no restriction — all centers visible).
    - Doctor / viewer: returns the user's own ``center_id`` so queries are
      automatically scoped to their center.
    """
    if current_user.role == "admin":
        return None
    return current_user.center_id
