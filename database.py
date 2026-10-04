from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base

# THE FIX: Changed ?sslmode=require to ?ssl=require for asyncpg compatibility
SQLALCHEMY_DATABASE_URL = "postgresql+asyncpg://postgres.gocrkgyfsnvfmunsgisi:%40Omkar140325@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres?ssl=require"

engine = create_async_engine(
    SQLALCHEMY_DATABASE_URL,
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