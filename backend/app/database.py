from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

# Async engine (for FastAPI routes)
async_engine = create_async_engine(settings.database_url, echo=False, pool_size=20)
async_session_factory = async_sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)

# Sync engine (for Alembic migrations and data import scripts)
sync_engine = create_engine(settings.database_url_sync, echo=False, pool_size=10)
sync_session_factory = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_async_session() -> AsyncSession:
    async with async_session_factory() as session:
        yield session


def get_sync_session() -> Session:
    with sync_session_factory() as session:
        yield session
