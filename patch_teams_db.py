import os
import sys
import io
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

# Force UTF-8 output to avoid charmap errors
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

load_dotenv()
engine = create_engine(os.getenv("DATABASE_URL"), isolation_level="AUTOCOMMIT")

with engine.connect() as conn:
    print("Creating channels table...")
    try:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS channels (
                id SERIAL PRIMARY KEY,
                team_id INTEGER NOT NULL,
                name VARCHAR(255) NOT NULL,
                channel_type VARCHAR(50) DEFAULT 'text',
                created_at VARCHAR(255)
            );
        """))
        print("Success! channels table created.")
    except Exception as e:
        print(f"Error creating channels table: {e}")

    print("Altering team_messages table to add channel_id...")
    try:
        conn.execute(text("ALTER TABLE team_messages ADD COLUMN channel_id INTEGER;"))
        print("Success! Added channel_id to team_messages.")
    except Exception as e:
        print(f"Column channel_id might already exist. Error: {e}")

    # Seed an initial channel for each existing team just in case
    try:
        teams = conn.execute(text("SELECT id FROM teams")).fetchall()
        for t in teams:
            team_id = t[0]
            # Check if general channel exists
            has_channel = conn.execute(text(f"SELECT id FROM channels WHERE team_id = {team_id} AND name = 'general'")).fetchone()
            if not has_channel:
                conn.execute(text(f"INSERT INTO channels (team_id, name, channel_type, created_at) VALUES ({team_id}, 'general', 'text', '2026-09-23T10:00:00.000Z')"))
                print(f"Created #general channel for team {team_id}")
                
                # Update existing messages to belong to this channel
                channel_id = conn.execute(text(f"SELECT id FROM channels WHERE team_id = {team_id} AND name = 'general'")).fetchone()[0]
                conn.execute(text(f"UPDATE team_messages SET channel_id = {channel_id} WHERE team_id = {team_id} AND channel_id IS NULL"))
    except Exception as e:
        print(f"Error seeding general channels: {e}")

print("Database patch complete.")
