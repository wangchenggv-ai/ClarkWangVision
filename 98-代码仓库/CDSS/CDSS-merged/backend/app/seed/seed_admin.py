"""Seed script: create default admin user and demo data."""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from app.database import engine, SessionLocal, Base
from app.models.center import Center
from app.models.user import User
from app.auth.jwt import get_password_hash


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    # Create default center
    center = db.query(Center).filter(Center.name == "高视星总部").first()
    if not center:
        center = Center(name="高视星总部", city="上海", contact_name="系统管理员", contact_phone="021-00000000")
        db.add(center)
        db.commit()
        db.refresh(center)
        print(f"Created center: {center.name} (id={center.id})")

    # Create admin user
    user = db.query(User).filter(User.username == "admin").first()
    if not user:
        user = User(
            username="admin",
            email="admin@gaoshixing.com",
            hashed_password=get_password_hash("admin123"),
            full_name="系统管理员",
            role="admin",
            center_id=center.id,
            is_active=True,
        )
        db.add(user)
        db.commit()
        print("Created admin user: admin / admin123")
    else:
        print("Admin user already exists")

    # Create demo centers
    for name in ["上海视光中心", "北京视光中心", "广州视光中心"]:
        existing = db.query(Center).filter(Center.name == name).first()
        if not existing:
            db.add(Center(name=name, city=name[:2]))
    db.commit()
    print("Demo centers created")
    db.close()


if __name__ == "__main__":
    seed()
