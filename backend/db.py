"""Database layer: one table, deviations."""
import os
from datetime import datetime
from dotenv import load_dotenv
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./deviations.db")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(bind=engine, autoflush=False)
Base = declarative_base()


class Deviation(Base):
    __tablename__ = "deviations"
    id = Column(Integer, primary_key=True)
    deviation_no = Column(String(20), unique=True)
    site = Column(String(120))
    date_of_occurrence = Column(String(10))
    title = Column(String(200))
    source = Column(String(80))
    product = Column(String(200))
    batch_number = Column(String(80))
    description = Column(Text)
    impact = Column(String(80))
    severity = Column(String(20))
    ai_reason = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self):
        out = {}
        for c in self.__table__.columns:
            v = getattr(self, c.name)
            out[c.name] = v.isoformat() if isinstance(v, datetime) else v
        return out


Base.metadata.create_all(engine)
