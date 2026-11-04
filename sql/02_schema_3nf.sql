-- ============================================================================
-- 02_schema_3nf.sql
-- 3NF Normalized Relational Schema for Payment Platform & Anti-Fraud Engine
-- ============================================================================

-- Drop tables if regenerating
DROP TABLE IF EXISTS ground_truth_rings CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS decisions CASCADE;
DROP TABLE IF EXISTS case_notes CASCADE;
DROP TABLE IF EXISTS case_alerts CASCADE;
DROP TABLE IF EXISTS investigation_cases CASCADE;
DROP TABLE IF EXISTS alerts CASCADE;
DROP TABLE IF EXISTS ledger_entries CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS idempotency_keys CASCADE;
DROP TABLE IF EXISTS account_ip_logs CASCADE;
DROP TABLE IF EXISTS customer_phones CASCADE;
DROP TABLE IF EXISTS account_devices CASCADE;
DROP TABLE IF EXISTS ip_addresses CASCADE;
DROP TABLE IF EXISTS phones CASCADE;
DROP TABLE IF EXISTS devices CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;
DROP TABLE IF EXISTS customers CASCADE;

-- ----------------------------------------------------------------------------
-- 1. Core Master Entities
-- ----------------------------------------------------------------------------

CREATE TABLE customers (
    customer_id BIGSERIAL PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    national_id_hash CHAR(64) NOT NULL,
    risk_tier VARCHAR(20) NOT NULL DEFAULT 'STANDARD' CHECK (risk_tier IN ('LOW', 'STANDARD', 'ELEVATED', 'HIGH')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE accounts (
    account_id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'FROZEN', 'CLOSED')),
    cached_balance NUMERIC(18,2) NOT NULL DEFAULT 0.00 CHECK (cached_balance >= 0),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE devices (
    device_id BIGSERIAL PRIMARY KEY,
    fingerprint CHAR(64) UNIQUE NOT NULL,
    device_model VARCHAR(100) NOT NULL,
    os_version VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE phones (
    phone_id BIGSERIAL PRIMARY KEY,
    phone_number VARCHAR(30) UNIQUE NOT NULL,
    carrier VARCHAR(100) NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE ip_addresses (
    ip_id BIGSERIAL PRIMARY KEY,
    ip_address INET UNIQUE NOT NULL,
    subnet_prefix CIDR NOT NULL,
    isp VARCHAR(150) NOT NULL,
    country_code CHAR(2) NOT NULL,
    is_proxy_or_vpn BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- ----------------------------------------------------------------------------
-- 2. Associative M:N Link Entities (Investigative Multi-Signal Graph)
-- ----------------------------------------------------------------------------

CREATE TABLE account_devices (
    account_id BIGINT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    device_id BIGINT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    first_used_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (account_id, device_id)
);

CREATE TABLE customer_phones (
    customer_id BIGINT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    phone_id BIGINT NOT NULL REFERENCES phones(phone_id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT TRUE,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (customer_id, phone_id)
);

CREATE TABLE account_ip_logs (
    log_id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    ip_id BIGINT NOT NULL REFERENCES ip_addresses(ip_id) ON DELETE CASCADE,
    logged_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    action_context VARCHAR(50) NOT NULL DEFAULT 'TRANSACTION'
);

-- ----------------------------------------------------------------------------
-- 3. Idempotency & Transaction Ledger Entities
-- ----------------------------------------------------------------------------

CREATE TABLE idempotency_keys (
    idem_key VARCHAR(128) PRIMARY KEY,
    request_hash CHAR(64) NOT NULL,
    response_payload JSONB,
    status_code INT NOT NULL DEFAULT 200,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE transactions (
    txn_id BIGSERIAL PRIMARY KEY,
    idem_key VARCHAR(128) UNIQUE REFERENCES idempotency_keys(idem_key),
    from_account BIGINT NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
    to_account BIGINT NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
    amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    txn_type VARCHAR(32) NOT NULL DEFAULT 'TRANSFER',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK (from_account <> to_account)
);

CREATE TABLE ledger_entries (
    entry_id BIGSERIAL PRIMARY KEY,
    txn_id BIGINT NOT NULL REFERENCES transactions(txn_id) ON DELETE RESTRICT,
    account_id BIGINT NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
    entry_type VARCHAR(6) NOT NULL CHECK (entry_type IN ('DEBIT', 'CREDIT')),
    amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- ----------------------------------------------------------------------------
-- 4. Investigation Cases, Alerts, Decisions & Audit Log
-- ----------------------------------------------------------------------------

CREATE TABLE alerts (
    alert_id BIGSERIAL PRIMARY KEY,
    txn_id BIGINT REFERENCES transactions(txn_id) ON DELETE SET NULL,
    account_id BIGINT REFERENCES accounts(account_id) ON DELETE SET NULL,
    rule_code VARCHAR(50) NOT NULL,
    risk_score NUMERIC(5,2) NOT NULL CHECK (risk_score >= 0.00 AND risk_score <= 100.00),
    explanation JSONB NOT NULL,
    evidence_query TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_REVIEW', 'DISMISSED', 'CONFIRMED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE investigation_cases (
    case_id BIGSERIAL PRIMARY KEY,
    case_title VARCHAR(200) NOT NULL,
    assigned_to VARCHAR(64) NOT NULL DEFAULT 'unassigned',
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'UNDER_INVESTIGATION', 'RESOLVED', 'CLOSED')),
    priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE case_alerts (
    case_id BIGINT NOT NULL REFERENCES investigation_cases(case_id) ON DELETE CASCADE,
    alert_id BIGINT NOT NULL REFERENCES alerts(alert_id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (case_id, alert_id)
);

CREATE TABLE case_notes (
    note_id BIGSERIAL PRIMARY KEY,
    case_id BIGINT NOT NULL REFERENCES investigation_cases(case_id) ON DELETE CASCADE,
    author_role VARCHAR(64) NOT NULL,
    note_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE decisions (
    decision_id BIGSERIAL PRIMARY KEY,
    case_id BIGINT NOT NULL REFERENCES investigation_cases(case_id) ON DELETE CASCADE,
    account_id BIGINT NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
    decision_type VARCHAR(20) NOT NULL CHECK (decision_type IN ('FREEZE', 'CLEAR')),
    rationale TEXT NOT NULL,
    decided_by VARCHAR(64) NOT NULL,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE audit_log (
    audit_id BIGSERIAL PRIMARY KEY,
    actor_role VARCHAR(64) NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    target_entity VARCHAR(64) NOT NULL,
    target_id VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    prev_hash CHAR(64) NOT NULL,
    row_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- ----------------------------------------------------------------------------
-- 5. Isolated Ground Truth Evaluation Table (O9 Benchmark)
-- ----------------------------------------------------------------------------

CREATE TABLE ground_truth_rings (
    ring_id INT NOT NULL,
    ring_type VARCHAR(50) NOT NULL,
    is_fraud BOOLEAN NOT NULL,
    txn_id BIGINT REFERENCES transactions(txn_id) ON DELETE CASCADE,
    account_id BIGINT REFERENCES accounts(account_id) ON DELETE CASCADE,
    role_in_ring VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
