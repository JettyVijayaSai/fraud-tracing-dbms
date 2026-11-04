from fastapi import APIRouter, HTTPException, Query, status
from config import get_db_connection

router = APIRouter(prefix="/api/metrics", tags=["Benchmarks & Query Optimization"])

@router.get("/evaluation")
def get_benchmark_evaluation():
    """
    Evaluates detection quality against ground_truth_rings.
    Computes True Positives (TP), False Positives (FP), False Negatives (FN),
    Precision, Recall, and F1-Score for the SQL anomaly detection rules.
    """
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Check if ground truth table has data
            cur.execute("SELECT COUNT(*) AS total FROM ground_truth_rings;")
            gt_count = cur.fetchone()["total"]
            if gt_count == 0:
                return {
                    "status": "NO_GROUND_TRUTH_DATA",
                    "message": "Ground truth table is empty. Run generate_synthetic_data.py to populate benchmark rings."
                }

            # Ground truth fraud transactions vs alerts raised
            cur.execute(
                """
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
                """
            )
            res = cur.fetchone()
            tp = res["tp"] or 0
            fp = res["fp"] or 0
            fn = res["fn"] or 0
            tn = res["tn"] or 0

            precision = round(tp / (tp + fp), 4) if (tp + fp) > 0 else 0.0
            recall = round(tp / (tp + fn), 4) if (tp + fn) > 0 else 0.0
            f1 = round(2 * (precision * recall) / (precision + recall), 4) if (precision + recall) > 0 else 0.0

            # Ring breakdown
            cur.execute(
                """
                SELECT ring_type, is_fraud,
                       COUNT(DISTINCT ring_id) AS total_rings,
                       COUNT(DISTINCT txn_id) AS total_transactions,
                       COUNT(DISTINCT CASE WHEN a.alert_id IS NOT NULL THEN gt.txn_id END) AS alerted_transactions
                FROM ground_truth_rings gt
                LEFT JOIN alerts a ON gt.txn_id = a.txn_id
                GROUP BY ring_type, is_fraud
                ORDER BY is_fraud DESC, ring_type ASC;
                """
            )
            breakdown = cur.fetchall()

            return {
                "summary": {
                    "true_positives": tp,
                    "false_positives": fp,
                    "false_negatives": fn,
                    "true_negatives": tn,
                    "precision": precision,
                    "recall": recall,
                    "f1_score": f1
                },
                "breakdown_by_pattern": breakdown
            }

@router.get("/explain")
def run_explain_analyze(query_type: str = Query("tracing", pattern="^(tracing|velocity|structuring|mule)$")):
    """
    Executes EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) on the specified analytical query
    to demonstrate execution time, buffer hits/reads, and index usage.
    """
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Find a representative transaction or account for the explain query
            if query_type == "tracing":
                cur.execute("SELECT txn_id FROM transactions ORDER BY txn_id ASC LIMIT 1;")
                sample = cur.fetchone()
                if not sample:
                    raise HTTPException(status_code=400, detail="No transactions available to benchmark")
                sample_id = sample["txn_id"]
                sql = f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM fn_trace_stolen_money({sample_id}, '48 hours'::interval, 6);"

            elif query_type == "velocity":
                sql = "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM vw_detection_velocity_burst LIMIT 100;"

            elif query_type == "structuring":
                sql = "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM vw_detection_structuring LIMIT 100;"

            else:
                sql = "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM vw_shared_device_links LIMIT 100;"

            cur.execute(sql)
            plan = cur.fetchone()[0]
            return {
                "query_type": query_type,
                "sql_analyzed": sql,
                "execution_plan": plan
            }

@router.get("/system-stats")
def get_system_stats():
    """Retrieve operational database metrics and table volumes."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    (SELECT COUNT(*) FROM customers) AS total_customers,
                    (SELECT COUNT(*) FROM accounts) AS total_accounts,
                    (SELECT COUNT(*) FROM transactions) AS total_transactions,
                    (SELECT COUNT(*) FROM ledger_entries) AS total_ledger_entries,
                    (SELECT COUNT(*) FROM alerts) AS total_alerts,
                    (SELECT COUNT(*) FROM investigation_cases) AS total_cases,
                    (SELECT COUNT(*) FROM audit_log) AS total_audit_entries,
                    (SELECT COUNT(*) FROM ground_truth_rings) AS total_ground_truth_records;
                """
            )
            return cur.fetchone()
