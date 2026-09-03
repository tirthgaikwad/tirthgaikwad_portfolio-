import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

# Load database URL from .env
load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("❌ Error: DATABASE_URL not found in .env file.")
    exit()

print("🔄 Connecting to database...")

try:
    engine = create_engine(DATABASE_URL)
    with engine.connect() as connection:
        print("⏳ Adding 'github_username' column to 'users' table...")
        connection.execute(text("ALTER TABLE users ADD COLUMN github_username VARCHAR DEFAULT '';"))
        connection.commit()
        print("✅ Success! 'github_username' column added successfully.")

except Exception as e:
    if "already exists" in str(e).lower():
        print("✅ The column 'github_username' already exists!")
    else:
        print(f"❌ Error: {e}")