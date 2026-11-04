-- ============================================================================
-- 05_detection_rules.sql
-- SQL Anomaly Detection Rules (Window Functions, Aggregates, CTEs, LISTEN/NOTIFY)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Analytical View: Rule 1 - VELOCITY_BURST
-- Detects rapid outgoing transactions (>= 5 transfers in 15 minutes or inter-transfer gap < 30s)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_detection_velocity_burst AS
WITH burst_metrics AS (
    SELECT
        txn_id,
        from_account,
        to_account,
        amount,
        created_at,
        LAG(created_at) OVER (PARTITION BY from_account ORDER BY created_at) AS prev_txn_time,
        EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (PARTITION BY from_account ORDER BY created_at))) AS seconds_since_prev,
        COUNT(*) OVER (
            PARTITION BY from_account
            ORDER BY created_at
            RANGE BETWEEN INTERVAL '15 minutes' PRECEDING AND CURRENT ROW
        ) AS rolling_15m_count,
        SUM(amount) OVER (
            PARTITION BY from_account
            ORDER BY created_at
            RANGE BETWEEN INTERVAL '15 minutes' PRECEDING AND CURRENT ROW
        ) AS rolling_15m_amount
    FROM transactions
)
SELECT
    txn_id,
    from_account AS account_id,
    'VELOCITY_BURST'::VARCHAR(50) AS rule_code,
    LEAST(100.00, 50.00 + (rolling_15m_count * 8.00) + CASE WHEN seconds_since_prev < 30 THEN 20.00 ELSE 0.00 END)::NUMERIC(5,2) AS risk_score,
    jsonb_build_object(
        'rolling_15m_count', rolling_15m_count,
        'rolling_15m_amount', rolling_15m_amount,
        'seconds_since_prev', seconds_since_prev,
        'txn_amount', amount,
        'flag_reason', 'Rapid velocity burst exceeding normal account activity threshold'
    ) AS explanation,
    'SELECT * FROM transactions WHERE from_account = ' || from_account || ' AND created_at BETWEEN ''' || (created_at - INTERVAL '15 minutes') || ''' AND ''' || created_at || '''' AS evidence_query,
    created_at
FROM burst_metrics
WHERE rolling_15m_count >= 5 OR (seconds_since_prev IS NOT NULL AND seconds_since_prev < 20);

-- ----------------------------------------------------------------------------
-- 2. Analytical View: Rule 2 - AMOUNT_ZSCORE_OUTLIER
-- Computes rolling mean and standard deviation per account, flags z-score > 3.0 and NTILE(100) > 95
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_detection_amount_zscore AS
WITH stats_window AS (
    SELECT
        txn_id,
        from_account,
        to_account,
        amount,
        created_at,
        AVG(amount) OVER w AS rolling_mean,
        COALESCE(STDDEV_POP(amount) OVER w, 0.00) AS rolling_stddev,
        NTILE(100) OVER (ORDER BY amount) AS percentile_tier
    FROM transactions
    WINDOW w AS (
        PARTITION BY from_account
        ORDER BY created_at
        ROWS BETWEEN 50 PRECEDING AND 1 PRECEDING
    )
),
scored AS (
    SELECT
        txn_id,
        from_account,
        to_account,
        amount,
        created_at,
        rolling_mean,
        rolling_stddev,
        percentile_tier,
        CASE
            WHEN rolling_stddev > 0 THEN ROUND(((amount - rolling_mean) / rolling_stddev)::NUMERIC, 2)
            ELSE 0.00
        END AS z_score
    FROM stats_window
)
SELECT
    txn_id,
    from_account AS account_id,
    'AMOUNT_ZSCORE_OUTLIER'::VARCHAR(50) AS rule_code,
    LEAST(100.00, 60.00 + (z_score * 7.50))::NUMERIC(5,2) AS risk_score,
    jsonb_build_object(
        'amount', amount,
        'historical_mean', ROUND(rolling_mean, 2),
        'historical_stddev', ROUND(rolling_stddev, 2),
        'z_score', z_score,
        'percentile_rank', percentile_tier,
        'flag_reason', 'Transfer amount significantly deviates from historical distribution'
    ) AS explanation,
    'SELECT txn_id, amount, created_at FROM transactions WHERE from_account = ' || from_account || ' ORDER BY created_at DESC LIMIT 50' AS evidence_query,
    created_at
FROM scored
WHERE z_score >= 3.0 AND amount > 500.00 AND percentile_tier >= 95;

-- ----------------------------------------------------------------------------
-- 3. Analytical View: Rule 3 - STRUCTURING_SMURFING
-- Detects multiple transfers just below reporting thresholds ($9,000 - $9,999.99) with 24-hr sum > $25,000
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_detection_structuring AS
WITH windowed_structuring AS (
    SELECT
        txn_id,
        from_account,
        to_account,
        amount,
        created_at,
        COUNT(*) OVER w AS smurf_window_count,
        SUM(amount) OVER w AS smurf_window_sum
    FROM transactions
    WHERE amount BETWEEN 9000.00 AND 9999.99
    WINDOW w AS (
        PARTITION BY from_account
        ORDER BY created_at
        RANGE BETWEEN INTERVAL '24 hours' PRECEDING AND CURRENT ROW
    )
)
SELECT
    txn_id,
    from_account AS account_id,
    'STRUCTURING_SMURFING'::VARCHAR(50) AS rule_code,
    LEAST(100.00, 65.00 + (smurf_window_count * 10.00))::NUMERIC(5,2) AS risk_score,
    jsonb_build_object(
        'smurf_count_24h', smurf_window_count,
        'smurf_sum_24h', smurf_window_sum,
        'current_amount', amount,
        'flag_reason', 'Repeated sub-threshold transfers aggregating above statutory reporting limits'
    ) AS explanation,
    'SELECT * FROM transactions WHERE from_account = ' || from_account || ' AND amount BETWEEN 9000 AND 9999.99 AND created_at BETWEEN ''' || (created_at - INTERVAL '24 hours') || ''' AND ''' || created_at || '''' AS evidence_query,
    created_at
FROM windowed_structuring
WHERE smurf_window_count >= 3 AND smurf_window_sum >= 25000.00;

-- ----------------------------------------------------------------------------
-- 4. Analytical View: Rule 4 - RAPID_PASS_THROUGH (Mule Layering)
-- Matches incoming and outgoing transfers within a short delta where outflow is 85%-100% of inflow
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_detection_rapid_pass_through AS
WITH account_flows AS (
    SELECT
        t_in.txn_id AS in_txn_id,
        t_out.txn_id AS out_txn_id,
        t_in.to_account AS intermediary_account,
        t_in.amount AS inflow_amount,
        t_out.amount AS outflow_amount,
        t_in.created_at AS in_time,
        t_out.created_at AS out_time,
        EXTRACT(EPOCH FROM (t_out.created_at - t_in.created_at)) / 3600.0 AS elapsed_hours,
        ROUND((t_out.amount / NULLIF(t_in.amount, 0.00)) * 100.0, 2) AS outflow_ratio_pct
    FROM transactions t_in
    JOIN transactions t_out
      ON t_in.to_account = t_out.from_account
     AND t_out.created_at > t_in.created_at
     AND t_out.created_at <= t_in.created_at + INTERVAL '6 hours'
    WHERE t_in.amount >= 1000.00
      AND (t_out.amount / NULLIF(t_in.amount, 0.00)) BETWEEN 0.85 AND 1.00
)
SELECT
    out_txn_id AS txn_id,
    intermediary_account AS account_id,
    'RAPID_PASS_THROUGH'::VARCHAR(50) AS rule_code,
    88.50::NUMERIC(5,2) AS risk_score,
    jsonb_build_object(
        'in_txn_id', in_txn_id,
        'out_txn_id', out_txn_id,
        'inflow_amount', inflow_amount,
        'outflow_amount', outflow_amount,
        'outflow_ratio_pct', outflow_ratio_pct,
        'elapsed_hours', ROUND(elapsed_hours::NUMERIC, 2),
        'flag_reason', 'Near-immediate passthrough of funds consistent with money-mule layering'
    ) AS explanation,
    'SELECT * FROM transactions WHERE txn_id IN (' || in_txn_id || ', ' || out_txn_id || ')' AS evidence_query,
    out_time AS created_at
FROM account_flows;

-- ----------------------------------------------------------------------------
-- 5. Comprehensive Anomaly Detection Sweep Stored Procedure
-- Sweeps views and materializes unique alerts into the alerts table
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sp_run_detection_sweep()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_total_alerts_inserted INT := 0;
    v_inserted INT;
BEGIN
    -- Insert Velocity Burst Alerts
    INSERT INTO alerts (txn_id, account_id, rule_code, risk_score, explanation, evidence_query, status, created_at)
    SELECT v.txn_id, v.account_id, v.rule_code, v.risk_score, v.explanation, v.evidence_query, 'OPEN', v.created_at
    FROM vw_detection_velocity_burst v
    LEFT JOIN alerts a ON a.txn_id = v.txn_id AND a.rule_code = v.rule_code
    WHERE a.alert_id IS NULL;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_total_alerts_inserted := v_total_alerts_inserted + v_inserted;

    -- Insert Amount Z-Score Outlier Alerts
    INSERT INTO alerts (txn_id, account_id, rule_code, risk_score, explanation, evidence_query, status, created_at)
    SELECT v.txn_id, v.account_id, v.rule_code, v.risk_score, v.explanation, v.evidence_query, 'OPEN', v.created_at
    FROM vw_detection_amount_zscore v
    LEFT JOIN alerts a ON a.txn_id = v.txn_id AND a.rule_code = v.rule_code
    WHERE a.alert_id IS NULL;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_total_alerts_inserted := v_total_alerts_inserted + v_inserted;

    -- Insert Structuring / Smurfing Alerts
    INSERT INTO alerts (txn_id, account_id, rule_code, risk_score, explanation, evidence_query, status, created_at)
    SELECT v.txn_id, v.account_id, v.rule_code, v.risk_score, v.explanation, v.evidence_query, 'OPEN', v.created_at
    FROM vw_detection_structuring v
    LEFT JOIN alerts a ON a.txn_id = v.txn_id AND a.rule_code = v.rule_code
    WHERE a.alert_id IS NULL;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_total_alerts_inserted := v_total_alerts_inserted + v_inserted;

    -- Insert Rapid Pass Through Alerts
    INSERT INTO alerts (txn_id, account_id, rule_code, risk_score, explanation, evidence_query, status, created_at)
    SELECT v.txn_id, v.account_id, v.rule_code, v.risk_score, v.explanation, v.evidence_query, 'OPEN', v.created_at
    FROM vw_detection_rapid_pass_through v
    LEFT JOIN alerts a ON a.txn_id = v.txn_id AND a.rule_code = v.rule_code
    WHERE a.alert_id IS NULL;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_total_alerts_inserted := v_total_alerts_inserted + v_inserted;

    RETURN v_total_alerts_inserted;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Insert-Time Trigger + LISTEN/NOTIFY Channel
-- Publishes real-time JSON alert payload to 'fraud_alerts_channel' on high-risk alert
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_notify_high_risk_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_payload JSONB;
BEGIN
    IF NEW.risk_score >= 60.00 THEN
        v_payload := jsonb_build_object(
            'event', 'HIGH_RISK_ALERT',
            'alert_id', NEW.alert_id,
            'txn_id', NEW.txn_id,
            'account_id', NEW.account_id,
            'rule_code', NEW.rule_code,
            'risk_score', NEW.risk_score,
            'explanation', NEW.explanation,
            'created_at', to_char(NEW.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.USOF')
        );

        -- Publish to PostgreSQL notification bus for WebSocket streaming
        PERFORM pg_notify('fraud_alerts_channel', v_payload::text);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_fraud_alert ON alerts;
CREATE TRIGGER trg_notify_fraud_alert
AFTER INSERT ON alerts
FOR EACH ROW
EXECUTE FUNCTION fn_notify_high_risk_alert();
