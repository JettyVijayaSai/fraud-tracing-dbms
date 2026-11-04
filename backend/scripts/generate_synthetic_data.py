import argparse
import hashlib
import io
import math
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import psycopg
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TimeElapsedColumn

console = Console()

DB_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgrespassword@localhost:5432/fraud_tracing_db")

def get_db(url=None):
    return psycopg.connect(url or DB_URL, autocommit=False)

def generate_master_entities(conn, num_customers=5000, num_accounts=8000, num_devices=3000, num_phones=5000, num_ips=2000):
    console.print(f"[bold cyan]Phase 1:[/bold cyan] Bulk generating master entities ({num_customers} customers, {num_accounts} accounts, {num_devices} devices, {num_phones} phones, {num_ips} IPs)...")
    with conn.cursor() as cur:
        # Customers
        cur.execute(f"""
            INSERT INTO customers (first_name, last_name, email, national_id_hash, risk_tier, created_at)
            SELECT
                'User_' || i,
                'Family_' || i,
                'user_' || i || '@vaultbank.com',
                encode(digest('NATID_' || i, 'sha256'), 'hex'),
                CASE WHEN i % 20 = 0 THEN 'HIGH' WHEN i % 5 = 0 THEN 'ELEVATED' ELSE 'STANDARD' END,
                clock_timestamp() - (random() * 365 || ' days')::interval
            FROM generate_series(1, {num_customers}) AS i;
        """)

        # Accounts
        cur.execute(f"""
            INSERT INTO accounts (customer_id, status, cached_balance, opened_at)
            SELECT
                ((i - 1) % {num_customers}) + 1,
                'ACTIVE',
                ROUND((1000.00 + (random() * 50000.00))::numeric, 2),
                clock_timestamp() - (random() * 300 || ' days')::interval
            FROM generate_series(1, {num_accounts}) AS i;
        """)

        # Devices
        cur.execute(f"""
            INSERT INTO devices (fingerprint, device_model, os_version, created_at)
            SELECT
                encode(digest('DEV_FP_' || i, 'sha256'), 'hex'),
                CASE WHEN i % 3 = 0 THEN 'iPhone 15 Pro' WHEN i % 3 = 1 THEN 'Samsung Galaxy S24' ELSE 'Google Pixel 8' END,
                CASE WHEN i % 2 = 0 THEN 'iOS 17.4' ELSE 'Android 14' END,
                clock_timestamp()
            FROM generate_series(1, {num_devices}) AS i;
        """)

        # Phones
        cur.execute(f"""
            INSERT INTO phones (phone_number, carrier, verified, created_at)
            SELECT
                '+1' || LPAD((5550000000 + i)::text, 10, '0'),
                CASE WHEN i % 3 = 0 THEN 'Verizon' WHEN i % 3 = 1 THEN 'AT&T' ELSE 'T-Mobile' END,
                TRUE,
                clock_timestamp()
            FROM generate_series(1, {num_phones}) AS i;
        """)

        # IPs
        cur.execute(f"""
            INSERT INTO ip_addresses (ip_address, subnet_prefix, isp, country_code, is_proxy_or_vpn, created_at)
            SELECT
                ('192.168.' || ((i / 256) % 256) || '.' || (i % 256))::inet,
                '192.168.0.0/16'::cidr,
                CASE WHEN i % 4 = 0 THEN 'Comcast' WHEN i % 4 = 1 THEN 'Cloudflare' ELSE 'AWS Hosting' END,
                'US',
                (i % 10 = 0),
                clock_timestamp()
            FROM generate_series(1, {num_ips}) AS i;
        """)

        # Links (account_devices, customer_phones, account_ip_logs)
        cur.execute(f"""
            INSERT INTO account_devices (account_id, device_id)
            SELECT i, ((i * 7) % {num_devices}) + 1 FROM generate_series(1, {num_accounts}) AS i;

            INSERT INTO customer_phones (customer_id, phone_id, is_primary)
            SELECT i, ((i * 3) % {num_phones}) + 1, TRUE FROM generate_series(1, {num_customers}) AS i;

            INSERT INTO account_ip_logs (account_id, ip_id, logged_at)
            SELECT i, ((i * 11) % {num_ips}) + 1, clock_timestamp() FROM generate_series(1, {num_accounts}) AS i;
        """)
    conn.commit()
    console.print("[green]✔ Master entities and associative links generated.[/green]")

def generate_background_transactions(conn, target_rows=100000, num_accounts=8000):
    console.print(f"[bold cyan]Phase 2:[/bold cyan] High-speed ingestion of {target_rows:,} background transactions via PostgreSQL COPY...")
    start_time = time.time()
    batch_size = 50000
    total_batches = math.ceil(target_rows / batch_size)

    base_time = datetime.now(timezone.utc) - timedelta(days=30)

    with conn.cursor() as cur:
        # Pre-fetch existing max txn_id
        cur.execute("SELECT COALESCE(MAX(txn_id), 0) FROM transactions;")
        start_txn_id = cur.fetchone()[0]

    current_txn_id = start_txn_id
    total_inserted = 0

    for b in range(total_batches):
        current_batch_size = min(batch_size, target_rows - total_inserted)
        txn_buffer = io.StringIO()
        ledger_buffer = io.StringIO()

        for _ in range(current_batch_size):
            current_txn_id += 1
            from_acc = random.randint(1, num_accounts)
            to_acc = random.randint(1, num_accounts)
            while to_acc == from_acc:
                to_acc = random.randint(1, num_accounts)

            # Normal log-normal amount distribution (majority $10 to $500)
            amount = round(Decimal(random.lognormvariate(4.0, 1.2)), 2)
            if amount < Decimal("5.00"):
                amount = Decimal("15.50")
            elif amount > Decimal("8000.00"):
                amount = Decimal("2450.00")

            seconds_offset = random.randint(0, 30 * 86400)
            txn_time = (base_time + timedelta(seconds=seconds_offset)).isoformat()
            idem_key = f"BG_IDEM_{current_txn_id}_{random.randint(10000, 99999)}"

            # Format for COPY into transactions: txn_id, idem_key, from_account, to_account, amount, txn_type, created_at
            txn_buffer.write(f"{current_txn_id}\t{idem_key}\t{from_acc}\t{to_acc}\t{amount}\tTRANSFER\t{txn_time}\n")

            # Balanced ledger entries (DEBIT and CREDIT)
            ledger_buffer.write(f"{current_txn_id}\t{from_acc}\tDEBIT\t{amount}\t{txn_time}\n")
            ledger_buffer.write(f"{current_txn_id}\t{to_acc}\tCREDIT\t{amount}\t{txn_time}\n")

        txn_buffer.seek(0)
        ledger_buffer.seek(0)

        with conn.cursor() as cur:
            with cur.copy("COPY transactions (txn_id, idem_key, from_account, to_account, amount, txn_type, created_at) FROM STDIN") as copy:
                copy.write(txn_buffer.read())

            with cur.copy("COPY ledger_entries (txn_id, account_id, entry_type, amount, created_at) FROM STDIN") as copy:
                copy.write(ledger_buffer.read())

        conn.commit()
        total_inserted += current_batch_size
        elapsed = time.time() - start_time
        console.print(f"  Ingested {total_inserted:,} / {target_rows:,} rows ({total_inserted / elapsed:,.0f} rows/sec)")

    # Advance transaction ID sequence to match max inserted id
    with conn.cursor() as cur:
        cur.execute("SELECT setval('transactions_txn_id_seq', (SELECT MAX(txn_id) FROM transactions));")
        cur.execute("SELECT setval('ledger_entries_entry_id_seq', (SELECT MAX(entry_id) FROM ledger_entries));")
    conn.commit()
    console.print(f"[green]✔ Ingested {target_rows:,} background transactions in {time.time() - start_time:.2f}s.[/green]")

def plant_ground_truth_rings(conn, num_accounts=8000):
    console.print("[bold cyan]Phase 3:[/bold cyan] Planting 25 Ground-Truth Fraud Rings & 25 Benign Look-Alikes...")
    now = datetime.now(timezone.utc) - timedelta(days=2)
    ring_id = 0

    with conn.cursor() as cur:
        cur.execute("SELECT COALESCE(MAX(txn_id), 0) FROM transactions;")
        next_txn_id = cur.fetchone()[0]

        # ---------------------------------------------------------------------
        # 1. Plant 10 Multi-Hop Account-Takeover & Layering Fraud Rings (Rings 1..10)
        # Structure: Victim -> Thief -> Mule Hop 1 -> Mule Hop 2 -> Cashout
        # ---------------------------------------------------------------------
        for i in range(10):
            ring_id += 1
            victim = 100 + i * 20
            thief = victim + 1
            mule1 = victim + 2
            mule2 = victim + 3
            cashout = victim + 4

            stolen_amt = Decimal("45000.00")
            hop1_amt = Decimal("44000.00") # 97% pass-through
            hop2_amt = Decimal("43000.00")
            cash_amt = Decimal("42500.00")

            t0 = now + timedelta(hours=i * 2)

            hops = [
                (victim, thief, stolen_amt, t0, "INITIAL_THEFT"),
                (thief, mule1, hop1_amt, t0 + timedelta(minutes=15), "MULE_HOP_1"),
                (mule1, mule2, hop2_amt, t0 + timedelta(minutes=45), "MULE_HOP_2"),
                (mule2, cashout, cash_amt, t0 + timedelta(hours=2), "CASHOUT")
            ]

            # Link mule1 and mule2 with a shared device to create an investigative signal
            shared_dev = 50 + i
            cur.execute(f"INSERT INTO account_devices (account_id, device_id) VALUES ({mule1}, {shared_dev}), ({mule2}, {shared_dev}) ON CONFLICT DO NOTHING;")

            for frm, to, amt, ts, role in hops:
                next_txn_id += 1
                cur.execute(
                    """
                    INSERT INTO transactions (txn_id, idem_key, from_account, to_account, amount, txn_type, created_at)
                    VALUES (%s, %s, %s, %s, %s, 'TRANSFER', %s);
                    """,
                    (next_txn_id, f"FRAUD_RING_{ring_id}_{next_txn_id}", frm, to, amt, ts)
                )
                cur.execute("INSERT INTO ledger_entries (txn_id, account_id, entry_type, amount, created_at) VALUES (%s, %s, 'DEBIT', %s, %s), (%s, %s, 'CREDIT', %s, %s);",
                            (next_txn_id, frm, amt, ts, next_txn_id, to, amt, ts))
                cur.execute(
                    """
                    INSERT INTO ground_truth_rings (ring_id, ring_type, is_fraud, txn_id, account_id, role_in_ring, created_at)
                    VALUES (%s, 'TAKEOVER_LAYERING_RING', TRUE, %s, %s, %s, %s);
                    """,
                    (ring_id, next_txn_id, frm, role, ts)
                )

        # ---------------------------------------------------------------------
        # 2. Plant 8 Structuring / Smurfing Fraud Rings (Rings 11..18)
        # Structure: 4 transfers between $9,200 and $9,800 within 4 hours
        # ---------------------------------------------------------------------
        for i in range(8):
            ring_id += 1
            smurf_acc = 400 + i * 15
            target_acc = smurf_acc + 1
            t_base = now + timedelta(hours=i * 3)

            for step in range(4):
                next_txn_id += 1
                smurf_amt = Decimal(f"{9200 + step * 180}.00")
                ts = t_base + timedelta(minutes=step * 40)
                cur.execute(
                    """
                    INSERT INTO transactions (txn_id, idem_key, from_account, to_account, amount, txn_type, created_at)
                    VALUES (%s, %s, %s, %s, %s, 'TRANSFER', %s);
                    """,
                    (next_txn_id, f"FRAUD_SMURF_{ring_id}_{next_txn_id}", smurf_acc, target_acc, smurf_amt, ts)
                )
                cur.execute("INSERT INTO ledger_entries (txn_id, account_id, entry_type, amount, created_at) VALUES (%s, %s, 'DEBIT', %s, %s), (%s, %s, 'CREDIT', %s, %s);",
                            (next_txn_id, smurf_acc, smurf_amt, ts, next_txn_id, target_acc, smurf_amt, ts))
                cur.execute(
                    """
                    INSERT INTO ground_truth_rings (ring_id, ring_type, is_fraud, txn_id, account_id, role_in_ring, created_at)
                    VALUES (%s, 'STRUCTURING_SMURF_RING', TRUE, %s, %s, %s, %s);
                    """,
                    (ring_id, next_txn_id, smurf_acc, f"SMURF_STEP_{step+1}", ts)
                )

        # ---------------------------------------------------------------------
        # 3. Plant 7 Velocity Burst Rings (Rings 19..25)
        # Structure: 6 rapid transfers within 5 minutes (Account Takeover drain)
        # ---------------------------------------------------------------------
        for i in range(7):
            ring_id += 1
            burst_acc = 600 + i * 10
            t_base = now + timedelta(hours=i * 2 + 1)

            for step in range(6):
                next_txn_id += 1
                dest_acc = random.randint(1, num_accounts)
                b_amt = Decimal("3200.00")
                ts = t_base + timedelta(seconds=step * 25)
                cur.execute(
                    """
                    INSERT INTO transactions (txn_id, idem_key, from_account, to_account, amount, txn_type, created_at)
                    VALUES (%s, %s, %s, %s, %s, 'TRANSFER', %s);
                    """,
                    (next_txn_id, f"FRAUD_BURST_{ring_id}_{next_txn_id}", burst_acc, dest_acc, b_amt, ts)
                )
                cur.execute("INSERT INTO ledger_entries (txn_id, account_id, entry_type, amount, created_at) VALUES (%s, %s, 'DEBIT', %s, %s), (%s, %s, 'CREDIT', %s, %s);",
                            (next_txn_id, burst_acc, b_amt, ts, next_txn_id, dest_acc, b_amt, ts))
                cur.execute(
                    """
                    INSERT INTO ground_truth_rings (ring_id, ring_type, is_fraud, txn_id, account_id, role_in_ring, created_at)
                    VALUES (%s, 'VELOCITY_BURST_RING', TRUE, %s, %s, %s, %s);
                    """,
                    (ring_id, next_txn_id, burst_acc, f"BURST_BURST_{step+1}", ts)
                )

        # ---------------------------------------------------------------------
        # 4. Plant 10 Benign Corporate Payroll Split Patterns (Rings 26..35)
        # Corporate parent sends salary payouts to 10 employees (Normal monthly batch)
        # ---------------------------------------------------------------------
        for i in range(10):
            ring_id += 1
            corp_acc = 800 + i * 20
            t_pay = now - timedelta(days=15) + timedelta(hours=i)

            for emp in range(10):
                next_txn_id += 1
                emp_acc = 1000 + emp * 50
                salary_amt = Decimal("4850.00")
                cur.execute(
                    """
                    INSERT INTO transactions (txn_id, idem_key, from_account, to_account, amount, txn_type, created_at)
                    VALUES (%s, %s, %s, %s, %s, 'PAYROLL', %s);
                    """,
                    (next_txn_id, f"BENIGN_PAYROLL_{ring_id}_{next_txn_id}", corp_acc, emp_acc, salary_amt, t_pay)
                )
                cur.execute("INSERT INTO ledger_entries (txn_id, account_id, entry_type, amount, created_at) VALUES (%s, %s, 'DEBIT', %s, %s), (%s, %s, 'CREDIT', %s, %s);",
                            (next_txn_id, corp_acc, salary_amt, t_pay, next_txn_id, emp_acc, salary_amt, t_pay))
                cur.execute(
                    """
                    INSERT INTO ground_truth_rings (ring_id, ring_type, is_fraud, txn_id, account_id, role_in_ring, created_at)
                    VALUES (%s, 'BENIGN_PAYROLL_SPLIT', FALSE, %s, %s, 'EMPLOYEE_SALARY', %s);
                    """,
                    (ring_id, next_txn_id, corp_acc, t_pay)
                )

        # ---------------------------------------------------------------------
        # 5. Plant 10 Benign Family Shared-Device Transfers (Rings 36..45)
        # Legitimate household sharing a tablet or IP sending money for groceries/rent
        # ---------------------------------------------------------------------
        for i in range(10):
            ring_id += 1
            parent_acc = 2000 + i * 5
            child_acc = parent_acc + 1
            fam_amt = Decimal("650.00")
            t_fam = now - timedelta(days=5) + timedelta(hours=i * 4)

            # Share device
            dev = 200 + i
            cur.execute(f"INSERT INTO account_devices (account_id, device_id) VALUES ({parent_acc}, {dev}), ({child_acc}, {dev}) ON CONFLICT DO NOTHING;")

            next_txn_id += 1
            cur.execute(
                """
                INSERT INTO transactions (txn_id, idem_key, from_account, to_account, amount, txn_type, created_at)
                VALUES (%s, %s, %s, %s, %s, 'FAMILY_TRANSFER', %s);
                """,
                (next_txn_id, f"BENIGN_FAM_{ring_id}_{next_txn_id}", parent_acc, child_acc, fam_amt, t_fam)
            )
            cur.execute("INSERT INTO ledger_entries (txn_id, account_id, entry_type, amount, created_at) VALUES (%s, %s, 'DEBIT', %s, %s), (%s, %s, 'CREDIT', %s, %s);",
                        (next_txn_id, parent_acc, fam_amt, t_fam, next_txn_id, child_acc, fam_amt, t_fam))
            cur.execute(
                """
                INSERT INTO ground_truth_rings (ring_id, ring_type, is_fraud, txn_id, account_id, role_in_ring, created_at)
                VALUES (%s, 'BENIGN_FAMILY_SHARE', FALSE, %s, %s, 'FAMILY_MEMBER', %s);
                """,
                (ring_id, next_txn_id, parent_acc, t_fam)
            )

        # ---------------------------------------------------------------------
        # 6. Plant 5 High-Volume Merchant Settlements (Rings 46..50)
        # Normal retail store end-of-day bank deposits
        # ---------------------------------------------------------------------
        for i in range(5):
            ring_id += 1
            store_acc = 3000 + i * 10
            bank_settle = store_acc + 1
            settle_amt = Decimal("18500.00")
            t_set = now - timedelta(days=2) + timedelta(hours=i * 6)

            next_txn_id += 1
            cur.execute(
                """
                INSERT INTO transactions (txn_id, idem_key, from_account, to_account, amount, txn_type, created_at)
                VALUES (%s, %s, %s, %s, %s, 'SETTLEMENT', %s);
                """,
                (next_txn_id, f"BENIGN_SETTLE_{ring_id}_{next_txn_id}", store_acc, bank_settle, settle_amt, t_set)
            )
            cur.execute("INSERT INTO ledger_entries (txn_id, account_id, entry_type, amount, created_at) VALUES (%s, %s, 'DEBIT', %s, %s), (%s, %s, 'CREDIT', %s, %s);",
                        (next_txn_id, store_acc, settle_amt, t_set, next_txn_id, bank_settle, settle_amt, t_set))
            cur.execute(
                """
                INSERT INTO ground_truth_rings (ring_id, ring_type, is_fraud, txn_id, account_id, role_in_ring, created_at)
                VALUES (%s, 'BENIGN_MERCHANT_SETTLEMENT', FALSE, %s, %s, 'MERCHANT_SETTLEMENT', %s);
                """,
                (ring_id, next_txn_id, store_acc, t_set)
            )

        # Advance sequences
        cur.execute("SELECT setval('transactions_txn_id_seq', (SELECT MAX(txn_id) FROM transactions));")
        cur.execute("SELECT setval('ledger_entries_entry_id_seq', (SELECT MAX(entry_id) FROM ledger_entries));")

    conn.commit()
    console.print(f"[green]✔ Planted 25 Ground-Truth Fraud Rings and 25 Benign Look-Alikes (Total Rings: {ring_id}).[/green]")

def run_anomaly_sweep(conn):
    console.print("[bold cyan]Phase 4:[/bold cyan] Executing in-database SQL anomaly detection sweep sp_run_detection_sweep()...")
    with conn.cursor() as cur:
        cur.execute("SELECT sp_run_detection_sweep();")
        res = cur.fetchone()
        conn.commit()
        console.print(f"[green]✔ Sweep completed: {res[0]} alerts recorded in PostgreSQL alerts table.[/green]")

def main():
    parser = argparse.ArgumentParser(description="Synthetic Financial Data Generator with Planted Fraud Rings")
    parser.add_argument("--rows", type=int, default=100000, help="Number of background transactions (e.g. 100000 or 1000000)")
    args = parser.parse_args()

    console.print(f"[bold magenta]=== Starting Synthetic Data Generation (Target: {args.rows:,} rows) ===[/bold magenta]")
    conn = get_db()
    try:
        generate_master_entities(conn)
        generate_background_transactions(conn, target_rows=args.rows)
        plant_ground_truth_rings(conn)
        run_anomaly_sweep(conn)
        console.print("[bold green]=== Synthetic Benchmark Pipeline Successfully Generated! ===[/bold green]")
    finally:
        conn.close()

if __name__ == "__main__":
    main()
