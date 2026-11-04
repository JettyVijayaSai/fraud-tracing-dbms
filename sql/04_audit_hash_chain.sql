-- ============================================================================
-- 04_audit_hash_chain.sql
-- Advisory-Locked SHA-256 Hash-Chained Append-Only Audit Trail
-- ============================================================================

-- Function to securely append a record to the tamper-evident hash chain
CREATE OR REPLACE FUNCTION fn_append_audit_log(
    p_actor_role VARCHAR(64),
    p_action_type VARCHAR(64),
    p_target_entity VARCHAR(64),
    p_target_id VARCHAR(64),
    p_payload JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_prev_hash CHAR(64);
    v_row_hash CHAR(64);
    v_created_at TIMESTAMPTZ;
    v_raw_canonical TEXT;
    v_new_audit_id BIGINT;
BEGIN
    -- Acquire transaction-level advisory lock to serialize audit log appends
    -- Lock key: 999001 (Audit log serialization lock)
    PERFORM pg_advisory_xact_lock(999001);

    -- Obtain row_hash of the latest record
    SELECT row_hash INTO v_prev_hash
    FROM audit_log
    ORDER BY audit_id DESC
    LIMIT 1;

    -- If audit_log is empty, use 64 zeros as the genesis hash
    IF v_prev_hash IS NULL THEN
        v_prev_hash := '0000000000000000000000000000000000000000000000000000000000000000';
    END IF;

    v_created_at := clock_timestamp();

    -- Canonical serialization string for cryptographic digest calculation
    v_raw_canonical := v_prev_hash || '|' ||
                       p_actor_role || '|' ||
                       p_action_type || '|' ||
                       p_target_entity || '|' ||
                       p_target_id || '|' ||
                       p_payload::text || '|' ||
                       to_char(v_created_at, 'YYYY-MM-DD"T"HH24:MI:SS.USOF');

    -- Compute SHA-256 digest
    v_row_hash := encode(digest(v_raw_canonical, 'sha256'), 'hex');

    -- Insert append-only audit record
    INSERT INTO audit_log (
        actor_role,
        action_type,
        target_entity,
        target_id,
        payload,
        prev_hash,
        row_hash,
        created_at
    ) VALUES (
        p_actor_role,
        p_action_type,
        p_target_entity,
        p_target_id,
        p_payload,
        v_prev_hash,
        v_row_hash,
        v_created_at
    ) RETURNING audit_id INTO v_new_audit_id;

    RETURN v_new_audit_id;
END;
$$;

-- Verification function: walks entire chain and verifies mathematical linkage & payloads
CREATE OR REPLACE FUNCTION fn_verify_audit_chain()
RETURNS TABLE (
    is_valid BOOLEAN,
    total_checked INT,
    corrupted_audit_id BIGINT,
    error_reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    r RECORD;
    v_expected_prev CHAR(64) := '0000000000000000000000000000000000000000000000000000000000000000';
    v_computed_hash CHAR(64);
    v_raw_canonical TEXT;
    v_count INT := 0;
BEGIN
    FOR r IN (SELECT * FROM audit_log ORDER BY audit_id ASC) LOOP
        v_count := v_count + 1;

        -- 1. Check link to previous hash
        IF r.prev_hash <> v_expected_prev THEN
            RETURN QUERY SELECT FALSE, v_count, r.audit_id,
                format('Hash chain link broken at audit_id %s: stored prev_hash [%s] does not match expected [%s]',
                       r.audit_id, r.prev_hash, v_expected_prev);
            RETURN;
        END IF;

        -- 2. Recompute row hash from contents
        v_raw_canonical := r.prev_hash || '|' ||
                           r.actor_role || '|' ||
                           r.action_type || '|' ||
                           r.target_entity || '|' ||
                           r.target_id || '|' ||
                           r.payload::text || '|' ||
                           to_char(r.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.USOF');

        v_computed_hash := encode(digest(v_raw_canonical, 'sha256'), 'hex');

        IF r.row_hash <> v_computed_hash THEN
            RETURN QUERY SELECT FALSE, v_count, r.audit_id,
                format('Payload tampering detected at audit_id %s: stored row_hash [%s] does not match computed digest [%s]',
                       r.audit_id, r.row_hash, v_computed_hash);
            RETURN;
        END IF;

        v_expected_prev := r.row_hash;
    END LOOP;

    -- If all rows pass verification
    RETURN QUERY SELECT TRUE, v_count, NULL::BIGINT, 'All audit log records verified successfully. Chain is mathematically intact.'::TEXT;
END;
$$;
