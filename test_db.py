import asyncio
from database import engine
from sqlalchemy import text

async def inspect_db():
    async with engine.begin() as conn:
        # Check all tables
        tables = await conn.execute(text("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' ORDER BY table_name
        """))
        print("=== TABLES ===")
        for row in tables:
            print(f"  {row[0]}")
        
        # Check users
        users = await conn.execute(text("SELECT id, name, college_name, department, skills, profile_pic, account_status FROM users ORDER BY id"))
        print("\n=== USERS ===")
        for row in users:
            print(f"  ID:{row[0]} | {row[1]} | {row[2]} | {row[3]} | Skills:{row[4][:50] if row[4] else 'N/A'} | Pic:{row[5][:30] if row[5] else 'none'} | Status:{row[6]}")
        
        # Check teams
        teams = await conn.execute(text("SELECT id, name, description, created_by FROM teams ORDER BY id"))
        print("\n=== TEAMS ===")
        for row in teams:
            print(f"  ID:{row[0]} | {row[1]} | {row[2][:60] if row[2] else 'N/A'} | Creator:{row[3]}")
        
        # Check team members
        tm = await conn.execute(text("SELECT id, team_id, user_id, role FROM team_members ORDER BY team_id"))
        print("\n=== TEAM MEMBERS ===")
        for row in tm:
            print(f"  ID:{row[0]} | TeamID:{row[1]} | UserID:{row[2]} | Role:{row[3]}")
        
        # Check projects
        projects = await conn.execute(text("SELECT id, user_id, title FROM projects ORDER BY id"))
        print("\n=== PROJECTS ===")
        for row in projects:
            print(f"  ID:{row[0]} | UserID:{row[1]} | {row[2]}")
        
        # Check messages count
        msgs = await conn.execute(text("SELECT COUNT(*) FROM messages"))
        print(f"\n=== MESSAGES: {msgs.scalar()} total ===")
        
        # Check team messages count
        tmsg = await conn.execute(text("SELECT COUNT(*) FROM team_messages"))
        print(f"=== TEAM MESSAGES: {tmsg.scalar()} total ===")
        
        # Check board posts
        bp = await conn.execute(text("SELECT id, title, category, author_id FROM board_posts ORDER BY id"))
        print("\n=== BOARD POSTS ===")
        for row in bp:
            print(f"  ID:{row[0]} | {row[1]} | Cat:{row[2]} | Author:{row[3]}")
        
        # Check notifications count
        notifs = await conn.execute(text("SELECT COUNT(*) FROM notifications"))
        print(f"\n=== NOTIFICATIONS: {notifs.scalar()} total ===")

asyncio.run(inspect_db())
