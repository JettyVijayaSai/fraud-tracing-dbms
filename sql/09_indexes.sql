-- ============================================================================
-- 09_indexes.sql
-- High-Performance Composite B-Tree & Specialized Indexes for Fraud & Tracing
-- ============================================================================

-- Primary composite indexes serving temporal money tracing recursive joins:
-- JOIN transactions nxt ON nxt.from_account = prev.to_account AND nxt.created_at > prev.created_at
CREATE INDEX IF NOT EXISTS idx_transactions_from_created
    ON transactions (from_account, created_at);

CREATE INDEX IF NOT EXISTS idx_transactions_to_created
    ON transactions (to_account, created_at);

-- Supporting indexes for velocity and structuring anomaly queries
CREATE INDEX IF NOT EXISTS idx_transactions_created_at
    ON transactions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_amount
    ON transactions (amount);

-- Ledger verification indexes
CREATE INDEX IF NOT EXISTS idx_ledger_entries_txn_id
    ON ledger_entries (txn_id);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_created
    ON ledger_entries (account_id, created_at);

-- Alerts query indexes
CREATE INDEX IF NOT EXISTS idx_alerts_risk_score
    ON alerts (risk_score DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_status
    ON alerts (status);

CREATE INDEX IF NOT EXISTS idx_alerts_txn_id
    ON alerts (txn_id);

CREATE INDEX IF NOT EXISTS idx_alerts_account_id
    ON alerts (account_id);

-- Investigative graph association indexes
CREATE INDEX IF NOT EXISTS idx_account_devices_device_id
    ON account_devices (device_id);

CREATE INDEX IF NOT EXISTS idx_customer_phones_phone_id
    ON customer_phones (phone_id);

CREATE INDEX IF NOT EXISTS idx_account_ip_logs_account_id
    ON account_ip_logs (account_id, logged_at);

CREATE INDEX IF NOT EXISTS idx_account_ip_logs_ip_id
    ON account_ip_logs (ip_id);

-- Audit log indexing
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
    ON audit_log (created_at ASC);

CREATE INDEX IF NOT EXISTS idx_audit_log_target
    ON audit_log (target_entity, target_id);

-- Ground truth evaluation indexing
CREATE INDEX IF NOT EXISTS idx_ground_truth_txn_id
    ON ground_truth_rings (txn_id);

CREATE INDEX IF NOT EXISTS idx_ground_truth_account_id
    ON ground_truth_rings (account_id);

CREATE INDEX IF NOT EXISTS idx_ground_truth_ring_id
    ON ground_truth_rings (ring_id);
