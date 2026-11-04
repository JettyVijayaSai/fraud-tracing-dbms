-- ============================================================================
-- 06_recursive_tracing.sql
-- WITH RECURSIVE Temporal Money Tracing (Cycle-Free, Bounded Hop, Haircut Rule)
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_trace_stolen_money(
    p_root_txn_id BIGINT,
    p_time_window INTERVAL DEFAULT INTERVAL '48 hours',
    p_max_hops INT DEFAULT 6
)
RETURNS TABLE (
    hop_depth INT,
    parent_txn_id BIGINT,
    txn_id BIGINT,
    from_account BIGINT,
    to_account BIGINT,
    txn_amount NUMERIC(18,2),
    attributed_amount NUMERIC(18,2),
    created_at TIMESTAMPTZ,
    path_accounts BIGINT[],
    path_txns BIGINT[],
    is_cycle BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
WITH RECURSIVE money_trail AS (
    -- ------------------------------------------------------------------------
    -- Base Case (Hop 1): The initial alerted/theft transaction
    -- ------------------------------------------------------------------------
    SELECT
        1 AS hop_depth,
        NULL::BIGINT AS parent_txn_id,
        t.txn_id,
        t.from_account,
        t.to_account,
        t.amount AS txn_amount,
        t.amount AS attributed_amount,
        t.created_at,
        ARRAY[t.from_account, t.to_account] AS path_accounts,
        ARRAY[t.txn_id] AS path_txns,
        FALSE AS is_cycle
    FROM transactions t
    WHERE t.txn_id = p_root_txn_id

    UNION ALL

    -- ------------------------------------------------------------------------
    -- Recursive Step (Hops 2..K): Follow downstream transfers strictly forward in time
    -- ------------------------------------------------------------------------
    SELECT
        prev.hop_depth + 1 AS hop_depth,
        prev.txn_id AS parent_txn_id,
        nxt.txn_id,
        nxt.from_account,
        nxt.to_account,
        nxt.amount AS txn_amount,
        -- Proportional (Haircut) Attribution:
        -- attributed = min(txn_amount, prev_attributed * (txn_amount / max(txn_amount, total_outflow_in_window)))
        ROUND(
            LEAST(
                nxt.amount,
                prev.attributed_amount * (nxt.amount / GREATEST(nxt.amount, out_agg.total_window_outflow))
            ),
            2
        ) AS attributed_amount,
        nxt.created_at,
        prev.path_accounts || nxt.to_account AS path_accounts,
        prev.path_txns || nxt.txn_id AS path_txns,
        (nxt.to_account = ANY(prev.path_accounts)) AS is_cycle
    FROM money_trail prev
    -- Downstream transfer where sender was recipient of prior hop
    JOIN transactions nxt
      ON nxt.from_account = prev.to_account
     AND nxt.created_at > prev.created_at
     AND nxt.created_at <= prev.created_at + p_time_window
    -- Calculate total outflow leaving this intermediary in the temporal window for proportional attribution
    CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(amount), nxt.amount) AS total_window_outflow
        FROM transactions
        WHERE from_account = prev.to_account
          AND created_at > prev.created_at
          AND created_at <= prev.created_at + p_time_window
    ) out_agg
    WHERE prev.hop_depth < p_max_hops
      AND NOT prev.is_cycle
      AND NOT (nxt.to_account = ANY(prev.path_accounts))
      AND prev.attributed_amount >= 1.00
)
SELECT
    hop_depth,
    parent_txn_id,
    txn_id,
    from_account,
    to_account,
    txn_amount,
    attributed_amount,
    created_at,
    path_accounts,
    path_txns,
    is_cycle
FROM money_trail
ORDER BY hop_depth ASC, created_at ASC;
$$;
