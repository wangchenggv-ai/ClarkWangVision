from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from app.config import settings

_is_sqlite = settings.DATABASE_URL.startswith("sqlite")
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=not _is_sqlite,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    **({} if _is_sqlite else {"pool_size": 10, "max_overflow": 20}),
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """FastAPI dependency that provides a SQLAlchemy database session.

    Yields the session to the caller and ensures the session is always
    closed after the request completes, even if an exception is raised.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
