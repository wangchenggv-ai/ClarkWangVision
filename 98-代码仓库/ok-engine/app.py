"""FastAPI application entry point.

Start with:
    python app.py
    uvicorn app:app --reload
"""

from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from db import engine as db_engine, Base
from models import Patient, Calculation, FollowUp  # noqa: ensure table registration

app = FastAPI(
    title="多焦点 OK 镜设计引擎",
    description="Multifocal Orthokeratology Lens Design Engine · GaoShiXing",
    version="0.1.0",
)

# CORS — allow all origins for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
from api.patients import router as patients_router
from api.calculations import router as cohort_router

app.include_router(patients_router)
app.include_router(cohort_router)

# Static files — serve /static/* and /index.html explicitly
static_dir = Path(__file__).resolve().parent / "static"
static_dir.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


@app.get("/")
async def serve_index():
    """Serve the SPA entry point."""
    from fastapi.responses import FileResponse
    return FileResponse(static_dir / "index.html")


@app.on_event("startup")
def on_startup():
    """Create tables on first run."""
    Base.metadata.create_all(bind=db_engine)


@app.get("/health")
def health_check():
    return {"status": "ok", "version": "0.1.0"}


# ── Run ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
