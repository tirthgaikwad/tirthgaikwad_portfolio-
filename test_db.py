import asyncio
from database import engine
from sqlalchemy import text

async def test_db():
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text('SELECT 1'))
            print('Connection Successful:', result.scalar() == 1)
    except Exception as e:
        print('Connection Failed:', str(e))

asyncio.run(test_db())
