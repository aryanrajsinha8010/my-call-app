import os
import sys
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

# Load server environment variables
load_dotenv(override=True)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("[Error] DATABASE_URL environment variable is missing!")
    sys.exit(1)

print("[System] Connecting to Supabase database...")
try:
    engine = create_engine(DATABASE_URL)
    connection = engine.connect()
    print("[Success] Connection established successfully.")
except Exception as e:
    print(f"[Error] Failed to connect to database: {e}")
    sys.exit(1)

def run_migration_file():
    print("\n[Migrating] Executing supabase_schema.sql migrations...")
    migration_path = os.path.join("..", "infra", "migrations", "supabase_schema.sql")
    if not os.path.exists(migration_path):
        # try fallback path
        migration_path = os.path.join("infra", "migrations", "supabase_schema.sql")
        
    if not os.path.exists(migration_path):
        print(f"[Error] Migration file not found at: {migration_path}")
        return

    with open(migration_path, "r") as f:
        sql_content = f.read()

    # SEC-03 FIX: Dynamically inject the active JWT_SECRET_KEY from env variables into the migration SQL
    # so that the RLS is always in sync with the active server configuration.
    jwt_secret = os.getenv("JWT_SECRET_KEY", "").strip()
    if not jwt_secret:
        print("[Warning] JWT_SECRET_KEY is missing from environment. Using default fallback key for RLS.")
    else:
        print(f"[System] Dynamically binding RLS to active JWT_SECRET_KEY...")
        sql_content = sql_content.replace('3f8a2c1d9e7b4f6a0d5c8e2b1a9f3d7e4c6b0a8f2e5d1c9b7a4f3e6d0c2b8a5f', jwt_secret)

    # Split SQL file into statements by semicolon, avoiding trigger blocks
    # A simple split could break plpgsql functions, so we split using a robust regex or execute as block
    # In PostgreSQL, we can execute the block directly or split correctly. Since supabase_schema.sql has standard statements,
    # we will run it as a single transactional block!
    try:
        connection.exec_driver_sql("BEGIN;")
        connection.exec_driver_sql(sql_content)
        connection.exec_driver_sql("COMMIT;")
        print("[Success] Supabase migrations, triggers, and RLS policies successfully applied!")
    except Exception as e:
        connection.exec_driver_sql("ROLLBACK;")
        print(f"[Error] Failed to apply schema migrations: {e}")

def apply_index_optimizations():
    print("\n[Optimizing] Injecting high-speed index queries...")
    index_queries = [
        "CREATE INDEX IF NOT EXISTS idx_call_logs_username ON public.call_logs(username);",
        "CREATE INDEX IF NOT EXISTS idx_call_logs_room_id ON public.call_logs(room_id);",
        "CREATE INDEX IF NOT EXISTS idx_meeting_summaries_room_name ON public.meeting_summaries(room_name);",
        "CREATE INDEX IF NOT EXISTS idx_recording_consents_room_name ON public.recording_consents(room_name);"
    ]
    
    for query in index_queries:
        try:
            connection.execute(text(query))
            print(f" ✓ Applied: {query.split(' ')[4]}")
        except Exception as e:
            print(f" ✗ Failed: {query} -> {e}")

def print_database_catalog_report():
    print("\n[Report] Active Database Catalog Verification:")
    
    # 1. Fetch tables
    tables_query = text("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name;
    """)
    try:
        tables = connection.execute(tables_query).fetchall()
        print("  Active Public Tables:")
        for t in tables:
            print(f"   • {t[0]}")
    except Exception as e:
        print(f"  Failed to query tables: {e}")

    # 2. Fetch Triggers
    triggers_query = text("""
        SELECT trigger_name, event_manipulation, event_object_table 
        FROM information_schema.triggers 
        WHERE trigger_schema = 'public';
    """)
    try:
        triggers = connection.execute(triggers_query).fetchall()
        print("\n  Active Postgres Triggers:")
        for tg in triggers:
            print(f"   • {tg[0]} ({tg[1]} on {tg[2]})")
    except Exception as e:
        print(f"  Failed to query triggers: {e}")

    # 3. Fetch Indexes
    indexes_query = text("""
        SELECT indexname, tablename 
        FROM pg_indexes 
        WHERE schemaname = 'public' AND indexname LIKE 'idx_%';
    """)
    try:
        indexes = connection.execute(indexes_query).fetchall()
        print("\n  Active Query Performance Indexes:")
        for idx in indexes:
            print(f"   • {idx[0]} on {idx[1]}")
    except Exception as e:
        print(f"  Failed to query indexes: {e}")

if __name__ == "__main__":
    try:
        # Run migrations
        run_migration_file()
        
        # Apply optimizations
        apply_index_optimizations()
        
        # Print database integrity report
        print_database_catalog_report()
    finally:
        connection.close()
        print("\n[System] Database connection closed safely.")
