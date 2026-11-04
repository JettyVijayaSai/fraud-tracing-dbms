import argparse
import os
import sys
from pathlib import Path
import psycopg
from rich.console import Console

console = Console()

# Add scripts directory to sys.path so we can import generator
CURRENT_DIR = Path(__file__).resolve().parent
REPO_ROOT = CURRENT_DIR.parent.parent
sys.path.append(str(CURRENT_DIR))

from generate_synthetic_data import (
    generate_master_entities,
    generate_background_transactions,
    plant_ground_truth_rings,
    run_anomaly_sweep
)

def run_migrations(conn, sql_dir: Path):
    console.print("\n[bold cyan]Step 1: Applying SQL Schemas, Triggers & Functions to Cloud Database...[/bold cyan]")
    sql_files = [
        "01_extensions_and_roles.sql",
        "02_schema_3nf.sql",
        "03_ledger_and_idempotency.sql",
        "04_audit_hash_chain.sql",
        "05_detection_rules.sql",
        "06_recursive_tracing.sql",
        "07_mule_network_links.sql",
        "08_security_rls_views.sql",
        "09_indexes.sql"
    ]

    for sf in sql_files:
        file_path = sql_dir / sf
        if not file_path.exists():
            console.print(f"[bold red]Error:[/bold red] Could not find {file_path}")
            sys.exit(1)

        console.print(f"  Executing [yellow]{sf}[/yellow]...")
        sql_content = file_path.read_text(encoding="utf-8")
        with conn.cursor() as cur:
            cur.execute(sql_content)
        conn.commit()

    console.print("[bold green]✔ All 9 SQL migration files successfully applied to cloud database![/bold green]\n")

def main():
    parser = argparse.ArgumentParser(description="Initialize Cloud PostgreSQL Database with 3NF Schema & Planted Benchmark Data")
    parser.add_argument("--db-url", type=str, default=os.getenv("DATABASE_URL"), help="PostgreSQL connection string (e.g. Render External Database URL)")
    parser.add_argument("--rows", type=int, default=100000, help="Number of background transactions (default: 100,000 for cloud quickstart)")
    args = parser.parse_args()

    if not args.db_url:
        console.print("[bold red]Error:[/bold red] Please provide --db-url or set the DATABASE_URL environment variable.")
        console.print("Example: python scripts/init_cloud_db.py --db-url \"postgresql://user:pass@dpg-xxx.oregon-postgres.render.com/dbname\"")
        sys.exit(1)

    console.print(f"[bold magenta]=== Initializing Cloud Database at {args.db_url.split('@')[-1]} ===[/bold magenta]")
    
    sql_dir = REPO_ROOT / "sql"
    
    try:
        conn = psycopg.connect(args.db_url, autocommit=False)
    except Exception as e:
        console.print(f"[bold red]Failed to connect to database:[/bold red] {e}")
        sys.exit(1)

    try:
        run_migrations(conn, sql_dir)
        console.print(f"[bold cyan]Step 2: Populating Master Entities & {args.rows:,} Benchmark Transactions...[/bold cyan]")
        generate_master_entities(conn)
        generate_background_transactions(conn, target_rows=args.rows)
        plant_ground_truth_rings(conn)
        run_anomaly_sweep(conn)
        console.print("\n[bold green]=== Cloud Database Fully Initialized and Seeded with Fraud Benchmark Data! ===[/bold green]")
    finally:
        conn.close()

if __name__ == "__main__":
    main()
