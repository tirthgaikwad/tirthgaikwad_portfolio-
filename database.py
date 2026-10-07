import os
from dotenv import load_dotenv
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set. Add it to your .env file.")

# asyncpg needs the +asyncpg driver and takes SSL via connect_args, not ?sslmode=
SQLALCHEMY_DATABASE_URL = (
    make_url(DATABASE_URL)
    .set(drivername="postgresql+asyncpg")
    .difference_update_query(["sslmode", "ssl"])
)

engine = create_async_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"ssl": "require"},
    pool_pre_ping=False,     # Skip expensive round-trip pre-ping on remote Supabase pooler
    pool_recycle=300,        # Recycles connections every 5 minutes to avoid stale connections
    pool_size=10,            # Keeps 10 connections open and ready
    max_overflow=20          # Allows up to 20 extra connections during traffic spikes
)

# AsyncSession is mandatory for handling high-traffic concurrency
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

Base = declarative_base()

async def get_db():
    async with SessionLocal() as db:
        try:
            yield db
        except Exception:
            await db.rollback()
            raise
