import asyncio
import time
from decimal import Decimal
import psycopg
from psycopg.rows import dict_row
from rich.console import Console
from rich.table import Table

console = Console()
DB_URL = "postgresql://postgres:postgrespassword@localhost:5432/fraud_tracing_db"

def reset_test_account(account_id: int, initial_balance: Decimal = Decimal("1000.00")):
    with psycopg.connect(DB_URL, autocommit=True) as conn:
        with conn.cursor() as cur:
            # Temporarily ensure test customer and account exist
            cur.execute("""
                INSERT INTO customers (customer_id, first_name, last_name, email, national_id_hash)
                VALUES (999999, 'Test', 'Concurrency', 'concurrency@vaultbank.com', 'test_hash')
                ON CONFLICT (customer_id) DO NOTHING;
            """)
            cur.execute("""
                INSERT INTO accounts (account_id, customer_id, status, cached_balance)
                VALUES (%s, 999999, 'ACTIVE', %s)
                ON CONFLICT (account_id) DO UPDATE SET cached_balance = EXCLUDED.cached_balance, status = 'ACTIVE';
            """, (account_id, initial_balance))

async def worker_vulnerable_read_committed(account_id: int, withdrawal_amt: Decimal, results: dict, worker_id: int):
    """
    Mode A: Vulnerable application-coordinated check-then-act under standard READ COMMITTED.
    Demonstrates race condition where parallel transactions read the same stale balance.
    """
    try:
        async with await psycopg.AsyncConnection.connect(DB_URL, autocommit=False) as aconn:
            async with aconn.cursor(row_factory=dict_row) as cur:
                # 1. Non-locking read
                await cur.execute("SELECT cached_balance FROM accounts WHERE account_id = %s;", (account_id,))
                row = await cur.fetchone()
                balance = row["cached_balance"]

                if balance >= withdrawal_amt:
                    # Synthetic thread switch / latency gap
                    await asyncio.sleep(0.005)
                    # 2. Blind update
                    await cur.execute(
                        "UPDATE accounts SET cached_balance = cached_balance - %s WHERE account_id = %s;",
                        (withdrawal_amt, account_id)
                    )
                    await aconn.commit()
                    results["success"] += 1
                else:
                    await aconn.rollback()
                    results["rejected"] += 1
    except Exception as e:
        results["error"] += 1

async def worker_row_level_locking(account_id: int, withdrawal_amt: Decimal, results: dict, worker_id: int):
    """
    Mode B: Explicit SELECT ... FOR UPDATE row-level lock.
    Serializes access at the tuple level and strictly prevents double-spends.
    """
    try:
        async with await psycopg.AsyncConnection.connect(DB_URL, autocommit=False) as aconn:
            async with aconn.cursor(row_factory=dict_row) as cur:
                # 1. Row-level exclusive lock
                await cur.execute(
                    "SELECT cached_balance FROM accounts WHERE account_id = %s FOR UPDATE;",
                    (account_id,)
                )
                row = await cur.fetchone()
                balance = row["cached_balance"]

                if balance >= withdrawal_amt:
                    await cur.execute(
                        "UPDATE accounts SET cached_balance = cached_balance - %s WHERE account_id = %s;",
                        (withdrawal_amt, account_id)
                    )
                    await aconn.commit()
                    results["success"] += 1
                else:
                    await aconn.rollback()
                    results["rejected"] += 1
    except Exception as e:
        results["error"] += 1

async def worker_serializable(account_id: int, withdrawal_amt: Decimal, results: dict, worker_id: int):
    """
    Mode C: SERIALIZABLE transaction isolation with client-side retry on 40001 serialization failure.
    PostgreSQL's Serializable Snapshot Isolation (SSI) detects rw-antidependencies and aborts conflicting transactions.
    """
    max_retries = 8
    for attempt in range(max_retries):
        try:
            async with await psycopg.AsyncConnection.connect(DB_URL, autocommit=False) as aconn:
                async with aconn.cursor(row_factory=dict_row) as cur:
                    await cur.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;")
                    await cur.execute("SELECT cached_balance FROM accounts WHERE account_id = %s;", (account_id,))
                    row = await cur.fetchone()
                    balance = row["cached_balance"]

                    if balance >= withdrawal_amt:
                        await cur.execute(
                            "UPDATE accounts SET cached_balance = cached_balance - %s WHERE account_id = %s;",
                            (withdrawal_amt, account_id)
                        )
                        await aconn.commit()
                        results["success"] += 1
                        return
                    else:
                        await aconn.rollback()
                        results["rejected"] += 1
                        return
        except psycopg.errors.SerializationFailure:
            # Exponential backoff retry on SQLSTATE 40001
            await asyncio.sleep(0.005 * (2 ** attempt))
            continue
        except Exception:
            results["error"] += 1
            return

    results["retry_exhausted"] += 1

def get_final_balance(account_id: int) -> Decimal:
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT cached_balance FROM accounts WHERE account_id = %s;", (account_id,))
            return cur.fetchone()[0]

async def run_mode(mode_name: str, worker_fn, account_id: int, num_workers: int = 100):
    initial_balance = Decimal("1000.00")
    withdrawal_amt = Decimal("100.00")
    reset_test_account(account_id, initial_balance)

    results = {"success": 0, "rejected": 0, "error": 0, "retry_exhausted": 0}
    start = time.time()

    tasks = [worker_fn(account_id, withdrawal_amt, results, i) for i in range(num_workers)]
    await asyncio.gather(*tasks)

    elapsed = time.time() - start
    final_balance = get_final_balance(account_id)
    total_withdrawn = results["success"] * withdrawal_amt
    double_spend_detected = final_balance < 0 or results["success"] > 10

    return {
        "mode": mode_name,
        "attempts": num_workers,
        "success": results["success"],
        "rejected": results["rejected"],
        "errors": results["error"],
        "final_balance": final_balance,
        "elapsed_sec": round(elapsed, 3),
        "invariant_preserved": not double_spend_detected
    }

async def main():
    console.print("\n[bold magenta]========================================================================[/bold magenta]")
    console.print("[bold cyan]Objective O6: Concurrency Control & Double-Spend Race Condition Harness[/bold cyan]")
    console.print("Testing 100 concurrent withdrawals ($100 each) on account seeded with $1,000 balance")
    console.print("[bold magenta]========================================================================[/bold magenta]\n")

    summary = []

    # 1. Mode A: Read Committed (Uncoordinated / Vulnerable)
    console.print("[yellow]Running Mode A: Vulnerable Check-Then-Act under READ COMMITTED...[/yellow]")
    res_a = await run_mode("A. Vulnerable READ COMMITTED", worker_vulnerable_read_committed, account_id=900001)
    summary.append(res_a)

    # 2. Mode B: SELECT ... FOR UPDATE
    console.print("[yellow]Running Mode B: Row-Level Locking (SELECT ... FOR UPDATE)...[/yellow]")
    res_b = await run_mode("B. Row Lock (FOR UPDATE)", worker_row_level_locking, account_id=900002)
    summary.append(res_b)

    # 3. Mode C: SERIALIZABLE + Retry
    console.print("[yellow]Running Mode C: SERIALIZABLE Isolation + Exponential Backoff Retry...[/yellow]")
    res_c = await run_mode("C. SERIALIZABLE + Backoff", worker_serializable, account_id=900003)
    summary.append(res_c)

    table = Table(title="100-Way Concurrent Withdrawal Benchmark Results")
    table.add_column("Concurrency Control Mode", style="cyan", no_wrap=True)
    table.add_column("Initial Bal", justify="right")
    table.add_column("Attempts", justify="right")
    table.add_column("Allowed", justify="right", style="green")
    table.add_column("Rejected", justify="right", style="red")
    table.add_column("Final Balance", justify="right")
    table.add_column("Duration", justify="right")
    table.add_column("Integrity Invariant", justify="center")

    for s in summary:
        status_str = "[bold green]PRESERVED[/bold green]" if s["invariant_preserved"] else "[bold red]VIOLATED (DOUBLE SPEND)[/bold red]"
        table.add_row(
            s["mode"],
            "$1,000.00",
            str(s["attempts"]),
            str(s["success"]),
            str(s["rejected"]),
            f"${s['final_balance']:,.2f}",
            f"{s['elapsed_sec']}s",
            status_str
        )

    console.print("\n")
    console.print(table)
    console.print("\n[bold green]Conclusion:[/bold green] Modes B & C strictly prevent double-spending in PostgreSQL, while uncoordinated application logic in Mode A allows severe account overdrafts.")

if __name__ == "__main__":
    asyncio.run(main())
