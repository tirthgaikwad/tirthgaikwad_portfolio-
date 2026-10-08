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
    pool_recycle=1800,       # main.py pings the pool every 2 minutes, so connections stay alive between requests
    pool_use_lifo=True,      # Reuse the most recently used connection, which already has its statements prepared
    pool_size=8,             # The Supabase session pooler allows 15 clients in total; the rest stay free for scripts
                             # and for stale clients the pooler still counts after a dropped network connection
    max_overflow=0,          # Never go past pool_size: an extra connection is refused with EMAXCONNSESSION
    pool_timeout=30          # When all 8 are busy, a request waits here for a free one instead of failing
)

# AsyncSession is mandatory for handling high-traffic concurrency
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

# Each statement commits on its own: no BEGIN/COMMIT round trips to the remote database.
# Use for reads and for single-statement writes; use SessionLocal when several writes must succeed together.
AutocommitSession = sessionmaker(
    bind=engine.execution_options(isolation_level="AUTOCOMMIT"),
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

async def get_fast_db():
    async with AutocommitSession() as db:
        yield db
