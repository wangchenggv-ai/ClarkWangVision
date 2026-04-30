"""Authentication router: login, token refresh, profile, logout, password change."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from jose import JWTError
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.auth.jwt import (
    create_access_token,
    create_refresh_token,
    get_password_hash,
    verify_password,
    verify_token,
)
from app.auth.permissions import get_current_user
from app.database import get_db
from app.models.user import User

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas (local to this router — simple enough to keep inline)
# ---------------------------------------------------------------------------

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class AccessTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    full_name: str | None
    role: str
    center_id: int | None
    is_active: bool

    model_config = {"from_attributes": True}


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _build_token_payload(user: User) -> dict:
    return {
        "user_id": user.id,
        "role": user.role,
        "center_id": user.center_id,
    }


# ---------------------------------------------------------------------------
# POST /login
# ---------------------------------------------------------------------------

@router.post(
    "/login",
    response_model=TokenResponse,
    summary="用户登录",
)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """Authenticate with *username* + *password* and return an access/refresh token pair."""
    user: User | None = (
        db.query(User).filter(User.username == form_data.username).first()
    )
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="账号已被禁用，请联系管理员",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Update last login timestamp
    user.last_login = datetime.now(timezone.utc)
    db.commit()

    payload = _build_token_payload(user)
    return TokenResponse(
        access_token=create_access_token(payload),
        refresh_token=create_refresh_token(payload),
    )


# ---------------------------------------------------------------------------
# POST /refresh
# ---------------------------------------------------------------------------

@router.post(
    "/refresh",
    response_model=AccessTokenResponse,
    summary="刷新访问令牌",
)
def refresh_token(body: RefreshRequest, db: Session = Depends(get_db)):
    """Exchange a valid refresh token for a new access token."""
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="刷新令牌无效或已过期，请重新登录",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        token_data = verify_token(body.refresh_token, expected_type="refresh")
    except JWTError:
        raise credentials_exc

    user: User | None = db.get(User, token_data.user_id)
    if not user or not user.is_active:
        raise credentials_exc

    new_access = create_access_token(_build_token_payload(user))
    return AccessTokenResponse(access_token=new_access)


# ---------------------------------------------------------------------------
# GET /me
# ---------------------------------------------------------------------------

@router.get(
    "/me",
    response_model=UserResponse,
    summary="获取当前用户信息",
)
def get_me(current_user: User = Depends(get_current_user)):
    """Return profile information for the currently authenticated user."""
    return current_user


# ---------------------------------------------------------------------------
# POST /logout
# ---------------------------------------------------------------------------

@router.post(
    "/logout",
    summary="退出登录",
)
def logout():
    """Client-side logout — instruct the client to discard its stored tokens.

    JWT tokens are stateless; invalidation is handled on the client by
    deleting the stored token.  Return 200 to confirm the request was received.
    """
    return {"message": "已退出登录"}


# ---------------------------------------------------------------------------
# POST /change-password
# ---------------------------------------------------------------------------

@router.post(
    "/change-password",
    summary="修改密码",
)
def change_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Allow the authenticated user to change their own password."""
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="当前密码不正确",
        )
    if len(body.new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="新密码长度不能少于6位",
        )
    current_user.hashed_password = get_password_hash(body.new_password)
    db.commit()
    return {"message": "密码修改成功"}
