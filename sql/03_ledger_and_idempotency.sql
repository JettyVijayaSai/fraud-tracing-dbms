-- ============================================================================
-- 03_ledger_and_idempotency.sql
-- Deferred Double-Entry Ledger Constraint Trigger & Idempotent Transfer Logic
-- ============================================================================

-- Function triggered at transaction commit time (DEFERRED) to enforce double-entry invariants
CREATE OR REPLACE FUNCTION fn_verify_ledger_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_target_txn_id BIGINT;
    v_expected_amount NUMERIC(18,2);
    v_total_debit NUMERIC(18,2);
    v_total_credit NUMERIC(18,2);
    v_entry_count INT;
BEGIN
    v_target_txn_id := COALESCE(NEW.txn_id, OLD.txn_id);
    IF v_target_txn_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Lookup master transaction amount
    SELECT amount INTO v_expected_amount
    FROM transactions
    WHERE txn_id = v_target_txn_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Double-entry invariant violation: Transaction % not found in transactions table', v_target_txn_id
            USING ERRCODE = '23503';
    END IF;

    -- Calculate aggregate debits, credits, and entry count
    SELECT
        COALESCE(SUM(CASE WHEN entry_type = 'DEBIT' THEN amount ELSE 0 END), 0.00),
        COALESCE(SUM(CASE WHEN entry_type = 'CREDIT' THEN amount ELSE 0 END), 0.00),
        COUNT(*)
    INTO v_total_debit, v_total_credit, v_entry_count
    FROM ledger_entries
    WHERE txn_id = v_target_txn_id;

    -- Check at least 2 entries (one debit, one credit)
    IF v_entry_count < 2 THEN
        RAISE EXCEPTION 'Double-entry violation on txn_id %: entry count is % (minimum 2 required)',
            v_target_txn_id, v_entry_count
            USING ERRCODE = '23514';
    END IF;

    -- Check sum(debit) == sum(credit)
    IF v_total_debit <> v_total_credit THEN
        RAISE EXCEPTION 'Double-entry violation on txn_id %: sum(DEBIT)=% does not equal sum(CREDIT)=%',
            v_target_txn_id, v_total_debit, v_total_credit
            USING ERRCODE = '23514';
    END IF;

    -- Check sum(debit) == transaction.amount
    IF v_total_debit <> v_expected_amount THEN
        RAISE EXCEPTION 'Double-entry violation on txn_id %: ledger sum=% does not match transaction amount=%',
            v_target_txn_id, v_total_debit, v_expected_amount
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

-- Drop trigger if already exists
DROP TRIGGER IF EXISTS trg_check_ledger_balance ON ledger_entries;

-- Create DEFERRED constraint trigger evaluated at COMMIT time
CREATE CONSTRAINT TRIGGER trg_check_ledger_balance
AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION fn_verify_ledger_balance();

-- ----------------------------------------------------------------------------
-- Idempotent Payment Processing Stored Function
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sp_process_payment(
    p_idem_key VARCHAR(128),
    p_from_account BIGINT,
    p_to_account BIGINT,
    p_amount NUMERIC(18,2),
    p_txn_type VARCHAR(32) DEFAULT 'TRANSFER'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_canonical_text TEXT;
    v_request_hash CHAR(64);
    v_existing_hash CHAR(64);
    v_existing_payload JSONB;
    v_existing_status INT;
    v_from_status VARCHAR(20);
    v_from_balance NUMERIC(18,2);
    v_to_status VARCHAR(20);
    v_txn_id BIGINT;
    v_created_at TIMESTAMPTZ;
    v_response_payload JSONB;
BEGIN
    IF p_from_account = p_to_account THEN
        RAISE EXCEPTION 'Sender and recipient accounts cannot be identical (%)', p_from_account
            USING ERRCODE = '23514';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero (%)', p_amount
            USING ERRCODE = '23514';
    END IF;

    -- 1. Canonical request hash computation
    v_canonical_text := p_from_account::text || '|' ||
                       p_to_account::text || '|' ||
                       to_char(p_amount, 'FM999999999999999999.00') || '|' ||
                       p_txn_type;
    v_request_hash := encode(digest(v_canonical_text, 'sha256'), 'hex');

    -- 2. Check Idempotency Key
    SELECT request_hash, response_payload, status_code
    INTO v_existing_hash, v_existing_payload, v_existing_status
    FROM idempotency_keys
    WHERE idem_key = p_idem_key;

    IF FOUND THEN
        -- Case A: Replay of identical request -> Return cached response immediately
        IF v_existing_hash = v_request_hash THEN
            RETURN v_existing_payload;
        ELSE
            -- Case B: Same idempotency key used with different payload -> 409 Conflict
            PERFORM fn_append_audit_log(
                'app_role',
                'IDEMPOTENCY_CONFLICT',
                'idempotency_keys',
                p_idem_key,
                jsonb_build_object(
                    'error', 'Idempotency key reused with mismatched request parameters',
                    'stored_hash', v_existing_hash,
                    'incoming_hash', v_request_hash,
                    'attempted_from', p_from_account,
                    'attempted_to', p_to_account,
                    'attempted_amount', p_amount
                )
            );
            RAISE EXCEPTION '409 Conflict: Idempotency key "%" has already been used for another transaction', p_idem_key
                USING ERRCODE = '23505';
        END IF;
    END IF;

    -- 3. Row-Level Locking & Balance Validation (Acquire locks in fixed order to prevent deadlocks)
    IF p_from_account < p_to_account THEN
        SELECT status, cached_balance INTO v_from_status, v_from_balance
        FROM accounts WHERE account_id = p_from_account FOR UPDATE;

        SELECT status INTO v_to_status
        FROM accounts WHERE account_id = p_to_account FOR UPDATE;
    ELSE
        SELECT status INTO v_to_status
        FROM accounts WHERE account_id = p_to_account FOR UPDATE;

        SELECT status, cached_balance INTO v_from_status, v_from_balance
        FROM accounts WHERE account_id = p_from_account FOR UPDATE;
    END IF;

    IF v_from_status IS NULL THEN
        RAISE EXCEPTION 'Sender account % does not exist', p_from_account
            USING ERRCODE = '23503';
    END IF;

    IF v_to_status IS NULL THEN
        RAISE EXCEPTION 'Recipient account % does not exist', p_to_account
            USING ERRCODE = '23503';
    END IF;

    IF v_from_status <> 'ACTIVE' THEN
        PERFORM fn_append_audit_log(
            'app_role', 'TRANSACTION_REJECTED', 'accounts', p_from_account::text,
            jsonb_build_object('reason', 'Sender account is not ACTIVE', 'status', v_from_status)
        );
        RAISE EXCEPTION 'Sender account % is % (must be ACTIVE)', p_from_account, v_from_status
            USING ERRCODE = '55000';
    END IF;

    IF v_to_status <> 'ACTIVE' THEN
        PERFORM fn_append_audit_log(
            'app_role', 'TRANSACTION_REJECTED', 'accounts', p_to_account::text,
            jsonb_build_object('reason', 'Recipient account is not ACTIVE', 'status', v_to_status)
        );
        RAISE EXCEPTION 'Recipient account % is % (must be ACTIVE)', p_to_account, v_to_status
            USING ERRCODE = '55000';
    END IF;

    IF v_from_balance < p_amount THEN
        PERFORM fn_append_audit_log(
            'app_role', 'INSUFFICIENT_FUNDS', 'accounts', p_from_account::text,
            jsonb_build_object('available_balance', v_from_balance, 'requested_amount', p_amount)
        );
        RAISE EXCEPTION 'Insufficient funds in sender account %: balance=%, requested=%',
            p_from_account, v_from_balance, p_amount
            USING ERRCODE = '55000';
    END IF;

    -- 4. Record Idempotency Key initially
    INSERT INTO idempotency_keys (idem_key, request_hash, response_payload, status_code)
    VALUES (p_idem_key, v_request_hash, NULL, 200);

    -- 5. Insert Master Transaction Record
    v_created_at := clock_timestamp();
    INSERT INTO transactions (idem_key, from_account, to_account, amount, txn_type, created_at)
    VALUES (p_idem_key, p_from_account, p_to_account, p_amount, p_txn_type, v_created_at)
    RETURNING txn_id INTO v_txn_id;

    -- 6. Insert Balanced Double-Entry Ledger Entries
    INSERT INTO ledger_entries (txn_id, account_id, entry_type, amount, created_at)
    VALUES (v_txn_id, p_from_account, 'DEBIT', p_amount, v_created_at);

    INSERT INTO ledger_entries (txn_id, account_id, entry_type, amount, created_at)
    VALUES (v_txn_id, p_to_account, 'CREDIT', p_amount, v_created_at);

    -- 7. Update Cached Account Balances
    UPDATE accounts
    SET cached_balance = cached_balance - p_amount
    WHERE account_id = p_from_account;

    UPDATE accounts
    SET cached_balance = cached_balance + p_amount
    WHERE account_id = p_to_account;

    -- 8. Prepare Response Payload and update Idempotency Key
    v_response_payload := jsonb_build_object(
        'status', 'COMPLETED',
        'txn_id', v_txn_id,
        'idem_key', p_idem_key,
        'from_account', p_from_account,
        'to_account', p_to_account,
        'amount', p_amount,
        'txn_type', p_txn_type,
        'created_at', to_char(v_created_at, 'YYYY-MM-DD"T"HH24:MI:SS.USOF')
    );

    UPDATE idempotency_keys
    SET response_payload = v_response_payload, status_code = 200
    WHERE idem_key = p_idem_key;

    -- 9. Append transaction audit event
    PERFORM fn_append_audit_log(
        'app_role',
        'TRANSACTION_SETTLED',
        'transactions',
        v_txn_id::text,
        v_response_payload
    );

    RETURN v_response_payload;
END;
$$;
