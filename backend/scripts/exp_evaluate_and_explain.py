import json
import time
import psycopg
from psycopg.rows import dict_row
from rich.console import Console
from rich.table import Table

console = Console()
DB_URL = "postgresql://postgres:postgrespassword@localhost:5432/fraud_tracing_db"

def evaluate_detection_metrics():
    console.print("\n[bold cyan]1. Evaluating SQL Anomaly Detection Rules against Planted Ground Truth...[/bold cyan]")
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            # Overall confusion matrix
            cur.execute("""
                WITH eval AS (
                    SELECT
                        gt.txn_id,
                        gt.is_fraud,
                        gt.ring_type,
                        CASE WHEN a.alert_id IS NOT NULL THEN TRUE ELSE FALSE END AS was_alerted
                    FROM ground_truth_rings gt
                    LEFT JOIN (
                        SELECT DISTINCT txn_id, alert_id FROM alerts
                    ) a ON gt.txn_id = a.txn_id
                    WHERE gt.txn_id IS NOT NULL
                )
                SELECT
                    COUNT(*) FILTER (WHERE is_fraud = TRUE AND was_alerted = TRUE) AS tp,
                    COUNT(*) FILTER (WHERE is_fraud = FALSE AND was_alerted = TRUE) AS fp,
                    COUNT(*) FILTER (WHERE is_fraud = TRUE AND was_alerted = FALSE) AS fn,
                    COUNT(*) FILTER (WHERE is_fraud = FALSE AND was_alerted = FALSE) AS tn
                FROM eval;
            """)
            res = cur.fetchone()
            tp = res["tp"] or 0
            fp = res["fp"] or 0
            fn = res["fn"] or 0
            tn = res["tn"] or 0

            precision = round(tp / (tp + fp), 4) if (tp + fp) > 0 else 0.0
            recall = round(tp / (tp + fn), 4) if (tp + fn) > 0 else 0.0
            f1 = round(2 * (precision * recall) / (precision + recall), 4) if (precision + recall) > 0 else 0.0

            table = Table(title="Overall Ground-Truth Benchmark Metrics (O9)")
            table.add_column("Metric", style="cyan")
            table.add_column("Count / Score", justify="right", style="bold")
            table.add_column("Interpretation", style="italic")

            table.add_row("True Positives (TP)", str(tp), "Planted fraud transactions correctly flagged")
            table.add_row("False Positives (FP)", str(fp), "Benign look-alikes incorrectly flagged")
            table.add_row("False Negatives (FN)", str(fn), "Planted fraud transactions missed by rules")
            table.add_row("True Negatives (TN)", str(tn), "Benign transactions correctly unflagged")
            table.add_row("Precision", f"{precision * 100:.2f}%", "Proportion of alerts that are genuine fraud")
            table.add_row("Recall", f"{recall * 100:.2f}%", "Proportion of actual fraud captured")
            table.add_row("F1-Score", f"{f1 * 100:.2f}%", "Harmonic mean of Precision and Recall")
            console.print(table)

            # Ring-type breakdown
            cur.execute("""
                SELECT ring_type, is_fraud,
                       COUNT(DISTINCT ring_id) AS total_rings,
                       COUNT(DISTINCT txn_id) AS total_txns,
                       COUNT(DISTINCT CASE WHEN a.alert_id IS NOT NULL THEN gt.txn_id END) AS alerted_txns
                FROM ground_truth_rings gt
                LEFT JOIN alerts a ON gt.txn_id = a.txn_id
                GROUP BY ring_type, is_fraud
                ORDER BY is_fraud DESC, ring_type ASC;
            """)
            breakdown = cur.fetchall()

            b_table = Table(title="Detection Performance by Typology Ring Pattern")
            b_table.add_column("Planted Ring Typology", style="cyan")
            b_table.add_column("Class", style="magenta")
            b_table.add_column("Rings", justify="right")
            b_table.add_column("Total Txns", justify="right")
            b_table.add_column("Alerted Txns", justify="right")
            b_table.add_column("Coverage / Spec", justify="right", style="green")

            for b in breakdown:
                cov = f"{(b['alerted_txns'] / b['total_txns']) * 100:.1f}%" if b['total_txns'] > 0 else "0.0%"
                b_table.add_row(
                    b["ring_type"],
                    "FRAUD" if b["is_fraud"] else "BENIGN",
                    str(b["total_rings"]),
                    str(b["total_txns"]),
                    str(b["alerted_txns"]),
                    cov
                )
            console.print(b_table)

def benchmark_explain_plans():
    console.print("\n[bold cyan]2. Measuring Query Plans & Speedup with EXPLAIN (ANALYZE, BUFFERS)...[/bold cyan]")
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            # Pick a representative root transaction
            cur.execute("SELECT txn_id FROM transactions ORDER BY txn_id ASC LIMIT 1;")
            root_id = cur.fetchone()[0]

            trace_query = f"SELECT * FROM fn_trace_stolen_money({root_id}, '48 hours'::interval, 6);"

            # Benchmark with existing indexes
            cur.execute(f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {trace_query}")
            plan_indexed = cur.fetchone()[0][0]
            indexed_time = plan_indexed["Plan"]["Actual Total Time"]

            # Drop composite indexes temporarily to test unindexed scan
            console.print("  [yellow]Temporarily dropping composite indexes (from_account, created_at)...[/yellow]")
            cur.execute("DROP INDEX IF EXISTS idx_transactions_from_created;")
            cur.execute("DROP INDEX IF EXISTS idx_transactions_to_created;")
            conn.commit()

            cur.execute(f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {trace_query}")
            plan_unindexed = cur.fetchone()[0][0]
            unindexed_time = plan_unindexed["Plan"]["Actual Total Time"]

            # Recreate composite indexes
            console.print("  [yellow]Recreating composite B-tree indexes...[/yellow]")
            cur.execute("CREATE INDEX idx_transactions_from_created ON transactions (from_account, created_at);")
            cur.execute("CREATE INDEX idx_transactions_to_created ON transactions (to_account, created_at);")
            conn.commit()

            speedup = unindexed_time / indexed_time if indexed_time > 0 else 1.0

            table = Table(title="Recursive Tracing EXPLAIN ANALYZE Comparison")
            table.add_column("Index Configuration", style="cyan")
            table.add_column("Scan Strategy", style="magenta")
            table.add_column("Execution Time (ms)", justify="right")
            table.add_column("Speedup Factor", justify="right", style="bold green")

            table.add_row(
                "Unindexed (Before 09_indexes.sql)",
                plan_unindexed["Plan"].get("Node Type", "Seq Scan"),
                f"{unindexed_time:.2f} ms",
                "1.0x (Baseline)"
            )
            table.add_row(
                "Composite B-tree Indexed (09_indexes.sql)",
                "Index Scan / Bitmap Index Scan",
                f"{indexed_time:.2f} ms",
                f"{speedup:.1f}x faster"
            )
            console.print(table)

def main():
    console.print("\n[bold magenta]========================================================================[/bold magenta]")
    console.print("[bold cyan]Objective O9: Precision/Recall/F1 & EXPLAIN ANALYZE Benchmark Suite[/bold cyan]")
    console.print("[bold magenta]========================================================================[/bold magenta]")
    evaluate_detection_metrics()
    benchmark_explain_plans()
    console.print("\n[bold green]=== Evaluation and EXPLAIN Suite Complete! ===[/bold green]\n")

if __name__ == "__main__":
    main()
