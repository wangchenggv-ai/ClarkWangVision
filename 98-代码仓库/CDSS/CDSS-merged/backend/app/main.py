from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
import app.models  # noqa: F401 — ensures all models are registered with SQLAlchemy
from app.routers import auth, centers, patients, exams, visits, export, cdss

app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description="近视离焦镜患者管理平台后端 API",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ---------------------------------------------------------------------------
# CORS — allow all origins in development; tighten for production
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(auth.router,     prefix="/api/auth",     tags=["auth"])
app.include_router(centers.router,  prefix="/api/centers",  tags=["centers"])
app.include_router(patients.router, prefix="/api/patients", tags=["patients"])
app.include_router(exams.router,    prefix="/api/exams",    tags=["exams"])
app.include_router(visits.router,   prefix="/api/visits",   tags=["visits"])
app.include_router(export.router,   prefix="/api/export",   tags=["export"])
app.include_router(cdss.router,     prefix="/api/cdss",     tags=["cdss"])


# ---------------------------------------------------------------------------
# Core endpoints
# ---------------------------------------------------------------------------
@app.get("/", tags=["root"])
def root():
    return {"message": "近视离焦镜管理平台 API", "version": "1.0.0"}


@app.get("/health", tags=["health"])
def health_check():
    return {"status": "ok"}
