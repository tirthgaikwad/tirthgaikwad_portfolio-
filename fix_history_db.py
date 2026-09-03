import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

# Load your Postgres database URL from the .env file
load_dotenv()
engine = create_engine(os.getenv("DATABASE_URL"))

# Connect to the database and drop the old history table
with engine.connect() as conn:
    conn.execute(text("DROP TABLE IF EXISTS history;"))
    conn.commit()
    print("✅ Success! Old 'history' table dropped.")
    print("🚀 You can now restart your Uvicorn server.")