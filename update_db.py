import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

# 1. Load your existing secrets from the .env file
load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("❌ Error: DATABASE_URL not found in .env file.")
    exit()

print("🔄 Connecting to the database...")

try:
    # 2. Create the database engine
    engine = create_engine(DATABASE_URL)
    
    # 3. Connect and execute the raw SQL command to add the column safely
    with engine.connect() as connection:
        print("⏳ Adding 'account_type' column to 'users' table...")
        
        # The SQL command to add the column with a default value of 'standard'
        connection.execute(text("ALTER TABLE users ADD COLUMN account_type VARCHAR DEFAULT 'standard';"))
        
        # Commit the changes to the database
        connection.commit()
        
        print("✅ Success! The 'account_type' column has been added to your database.")
        print("🚀 You can now restart your Uvicorn server.")

except Exception as e:
    # If the column already exists, it will throw an error, which is fine!
    error_msg = str(e)
    if "already exists" in error_msg.lower():
        print("✅ The column 'account_type' already exists! You are good to go.")
    else:
        print(f"❌ An error occurred: {error_msg}")