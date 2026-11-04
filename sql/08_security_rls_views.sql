-- ============================================================================
-- 08_security_rls_views.sql
-- Row-Level Security (RLS), PII Masked Views, and Audit Immutability Enforcement
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PII Masked Views for Non-Investigative Roles
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_masked_customers AS
SELECT
    c.customer_id,
    c.first_name,
    SUBSTRING(c.last_name, 1, 1) || '***' AS masked_last_name,
    SUBSTRING(c.email, 1, 2) || '***@' || SPLIT_PART(c.email, '@', 2) AS masked_email,
    SUBSTRING(c.national_id_hash, 1, 6) || '...' || SUBSTRING(c.national_id_hash, 59, 6) AS masked_national_id,
    c.risk_tier,
    c.created_at
FROM customers c;

CREATE OR REPLACE VIEW vw_masked_phones AS
SELECT
    cp.customer_id,
    p.phone_id,
    '***-***-' || RIGHT(p.phone_number, 4) AS masked_phone,
    p.carrier,
    p.verified
FROM customer_phones cp
JOIN phones p ON cp.phone_id = p.phone_id;

-- ----------------------------------------------------------------------------
-- 2. Row-Level Security (RLS) on Investigation Cases
-- ----------------------------------------------------------------------------
ALTER TABLE investigation_cases ENABLE ROW LEVEL SECURITY;

-- Allow analysts and investigators to read all cases
DROP POLICY IF EXISTS p_investigation_cases_read ON investigation_cases;
CREATE POLICY p_investigation_cases_read ON investigation_cases
    FOR SELECT
    USING (
        CURRENT_USER IN ('postgres', 'investigator_user', 'fraud_analyst_user', 'compliance_auditor_user')
        OR pg_has_role(CURRENT_USER, 'investigator_role', 'MEMBER')
        OR pg_has_role(CURRENT_USER, 'analyst_role', 'MEMBER')
        OR pg_has_role(CURRENT_USER, 'auditor_role', 'MEMBER')
    );

-- Only investigators can insert or update cases
DROP POLICY IF EXISTS p_investigation_cases_modify ON investigation_cases;
CREATE POLICY p_investigation_cases_modify ON investigation_cases
    FOR ALL
    USING (
        CURRENT_USER IN ('postgres', 'investigator_user')
        OR pg_has_role(CURRENT_USER, 'investigator_role', 'MEMBER')
    )
    WITH CHECK (
        CURRENT_USER IN ('postgres', 'investigator_user')
        OR pg_has_role(CURRENT_USER, 'investigator_role', 'MEMBER')
    );

-- ----------------------------------------------------------------------------
-- 3. Audit Log Immutability Protection
-- ----------------------------------------------------------------------------

-- Revoke all mutation privileges on audit_log from all standard roles
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app_role, analyst_role, investigator_role, auditor_role;

-- Enforce zero-mutation via Defense-in-Depth Trigger
CREATE OR REPLACE FUNCTION fn_prevent_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Cryptographic Ledger Invariant: audit_log is strictly append-only. Mutations (UPDATE/DELETE/TRUNCATE) are forbidden.'
        USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_no_modify ON audit_log;
CREATE TRIGGER trg_audit_log_no_modify
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_audit_log_mutation();

-- ----------------------------------------------------------------------------
-- 4. Explicit Object Grants for Principle of Least Privilege
-- ----------------------------------------------------------------------------

-- app_role grants
GRANT SELECT, INSERT ON idempotency_keys TO app_role;
GRANT SELECT, INSERT ON transactions TO app_role;
GRANT SELECT, INSERT ON ledger_entries TO app_role;
GRANT SELECT, UPDATE ON accounts TO app_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_role;
GRANT EXECUTE ON FUNCTION sp_process_payment(VARCHAR, BIGINT, BIGINT, NUMERIC, VARCHAR) TO app_role;
GRANT EXECUTE ON FUNCTION fn_append_audit_log(VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB) TO app_role;

-- analyst_role grants
GRANT SELECT ON vw_masked_customers TO analyst_role;
GRANT SELECT ON accounts TO analyst_role;
GRANT SELECT ON transactions TO analyst_role;
GRANT SELECT ON alerts TO analyst_role;
GRANT SELECT ON vw_detection_velocity_burst TO analyst_role;
GRANT SELECT ON vw_detection_amount_zscore TO analyst_role;
GRANT SELECT ON vw_detection_structuring TO analyst_role;
GRANT SELECT ON vw_detection_rapid_pass_through TO analyst_role;
GRANT EXECUTE ON FUNCTION sp_run_detection_sweep() TO analyst_role;

-- investigator_role grants
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO investigator_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO investigator_role;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM investigator_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO investigator_role;

-- auditor_role grants
GRANT SELECT ON audit_log TO auditor_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO auditor_role;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM auditor_role;
GRANT EXECUTE ON FUNCTION fn_verify_audit_chain() TO auditor_role;
