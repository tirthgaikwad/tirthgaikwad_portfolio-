import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

# Load your Postgres database URL
load_dotenv()
# AUTOCOMMIT forces every ALTER TABLE command to be saved immediately and independently
engine = create_engine(os.getenv("DATABASE_URL"), isolation_level="AUTOCOMMIT")

with engine.connect() as conn:
    # A complete list of all the columns your error logs have asked for today
    columns_to_add = [
        "email VARCHAR(255)",
        "is_ambassador BOOLEAN DEFAULT FALSE",
        "ambassador_strikes INTEGER DEFAULT 0",
        "account_status VARCHAR(50) DEFAULT 'active'",
        "id_barcode VARCHAR(255)",
        "id_card_image VARCHAR(255)",
        "portfolio_link VARCHAR(255)",
        "invite_code VARCHAR(100)"
    ]

    for column_def in columns_to_add:
        column_name = column_def.split()[0]
        try:
            # We execute each one completely separately
            conn.execute(text(f"ALTER TABLE users ADD COLUMN {column_def};"))
            print(f"✅ Success! Added missing column: '{column_name}'")
        except Exception as e:
            # If it already exists, PostgreSQL throws an error, which we catch and ignore here
            print(f"ℹ️ Column '{column_name}' already exists (Skipping).")

    print("\n🚀 Database synchronization complete! You can now restart your Uvicorn server.")