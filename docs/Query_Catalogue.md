# SQL Query & Analytical Function Catalogue

This catalogue provides the technical reference, parameter signatures, mathematical formulations, and execution semantics for all PostgreSQL logic implemented in the **Fraud Detection and Temporal Money Tracing System**.

---

## 1. Idempotent Double-Entry Transaction Engine

### 1.1 `sp_process_payment`
* **File:** `sql/03_ledger_and_idempotency.sql`
* **Type:** Stored PL/pgSQL Function
* **Parameters:**
  * `p_idem_key VARCHAR(128)`: Client-provided idempotency identifier
  * `p_from_account BIGINT`: Source account ID
  * `p_to_account BIGINT`: Target account ID
  * `p_amount NUMERIC(18,2)`: Exact monetary amount transferred
  * `p_txn_type VARCHAR(32)`: Transfer taxonomy classification
* **Return Type:** `JSONB`
* **Mechanics:**
  1. Computes canonical SHA-256 digest of payload:
     $$\text{hash} = \text{SHA-256}(p\_from \parallel p\_to \parallel p\_amount \parallel p\_type)$$
  2. Queries `idempotency_keys`:
     * If key exists with identical hash: Returns cached `response_payload` immediately (Zero side-effects).
     * If key exists with conflicting hash: Aborts with `409 Conflict` (SQLSTATE `23505`) and logs security alert to `audit_log`.
  3. Locks source and recipient account rows using deterministic order (`MIN(from, to)` followed by `MAX(from, to)`) with `SELECT ... FOR UPDATE` to prevent deadlocks and race conditions.
  4. Enforces $cached\_balance \ge p\_amount$ and both accounts in `ACTIVE` status.
  5. Inserts `transactions`, balanced `DEBIT` and `CREDIT` rows in `ledger_entries`, updates cached balances, updates `idempotency_keys`, and writes an immutable hash-chained audit row.

---

### 1.2 `fn_verify_ledger_balance` (Double-Entry Deferred Constraint Trigger)
* **File:** `sql/03_ledger_and_idempotency.sql`
* **Trigger Type:** `CONSTRAINT TRIGGER ... AFTER INSERT OR UPDATE OR DELETE ON ledger_entries DEFERRABLE INITIALLY DEFERRED`
* **Evaluation Time:** Transaction `COMMIT`
* **Invariant Enforced:**
  For any modified `txn_id`:
  $$\sum \text{DEBIT} = \sum \text{CREDIT} = \text{transactions.amount} \quad \land \quad \text{COUNT}(entries) \ge 2$$
* If any discrepancy exists, the commit is aborted and rolled back.

---

## 2. Advanced SQL Anomaly Detection Rules (Objective O3)

### 2.1 Rule 1: High-Frequency Outgoing Velocity Burst (`vw_detection_velocity_burst`)
* **File:** `sql/05_detection_rules.sql`
* **SQL Constructs:** `LAG() OVER (...)`, Rolling `COUNT(*) OVER (RANGE BETWEEN INTERVAL '15 minutes' PRECEDING AND CURRENT ROW)`.
* **Detection Threshold:** $\ge 5$ outgoing transactions in 15 minutes OR inter-transaction time gap $< 20$ seconds.
* **Risk Score Formula:**
  $$\text{Risk} = \min\left(100.00,\; 50.00 + (N_{\text{15m}} \times 8.00) + [20.00 \text{ if } \Delta t < 30s]\right)$$

---

### 2.2 Rule 2: Amount Z-Score Outlier (`vw_detection_amount_zscore`)
* **File:** `sql/05_detection_rules.sql`
* **SQL Constructs:** `AVG(amount) OVER w`, `STDDEV_POP(amount) OVER w` across 50 preceding transactions, `NTILE(100) OVER (ORDER BY amount)`.
* **Mathematical Outlier Criterion:**
  $$z = \frac{\text{amount} - \mu_{50}}{\sigma_{50}} \ge 3.0 \quad \land \quad \text{NTILE}(100) \ge 95$$

---

### 2.3 Rule 3: Structuring / Smurfing Detection (`vw_detection_structuring`)
* **File:** `sql/05_detection_rules.sql`
* **SQL Constructs:** Rolling frame `RANGE BETWEEN INTERVAL '24 hours' PRECEDING AND CURRENT ROW`.
* **Criterion:**
  $$\text{amount} \in [9000.00, 9999.99] \quad \land \quad \text{COUNT}_{24h} \ge 3 \quad \land \quad \sum_{24h} \text{amount} \ge 25000.00$$

---

### 2.4 Rule 4: Rapid Pass-Through Mule Layering (`vw_detection_rapid_pass_through`)
* **File:** `sql/05_detection_rules.sql`
* **SQL Constructs:** Self-join between incoming and outgoing transfers on intermediary accounts within $\Delta t \le 6$ hours.
* **Criterion:**
  $$t_{in}.\text{to\_account} = t_{out}.\text{from\_account} \quad \land \quad 0.85 \le \frac{t_{out}.\text{amount}}{t_{in}.\text{amount}} \le 1.00$$

---

## 3. Recursive Temporal Money Tracing (Objective O4)

### 3.1 `fn_trace_stolen_money`
* **File:** `sql/06_recursive_tracing.sql`
* **Signature:**
  ```sql
  fn_trace_stolen_money(
      p_root_txn_id BIGINT,
      p_time_window INTERVAL DEFAULT INTERVAL '48 hours',
      p_max_hops INT DEFAULT 6
  ) RETURNS TABLE (...)
  ```

#### Algorithmic Formulation
1. **Base Case ($k = 1$):**
   ```sql
   SELECT 1 AS hop_depth, NULL::BIGINT AS parent_txn_id, t.txn_id,
          t.from_account, t.to_account, t.amount AS txn_amount,
          t.amount AS attributed_amount, t.created_at,
          ARRAY[t.from_account, t.to_account] AS path_accounts,
          ARRAY[t.txn_id] AS path_txns, FALSE AS is_cycle
   FROM transactions t WHERE t.txn_id = p_root_txn_id
   ```

2. **Recursive Traversal ($k \le K$):**
   * **Temporal Ordering Constraint:**
     $$t_{k+1}.\text{created\_at} > t_k.\text{created\_at} \quad \land \quad t_{k+1}.\text{created\_at} \le t_k.\text{created\_at} + \Delta$$
   * **Cycle Prevention Constraint:**
     $$\text{NOT } (t_{k+1}.\text{to\_account} = \text{ANY}(path\_accounts))$$
   * **Proportional (Haircut) Attribution Rule:**
     $$\text{attributed}_{k+1} = \min\left(t_{k+1}.\text{amount},\; \text{attributed}_k \times \frac{t_{k+1}.\text{amount}}{\max(t_{k+1}.\text{amount}, \text{total\_outflow\_in\_window})}\right)$$
     Where $\text{total\_outflow\_in\_window}$ is computed via `CROSS JOIN LATERAL`:
     ```sql
     SELECT COALESCE(SUM(amount), nxt.amount) AS total_window_outflow
     FROM transactions
     WHERE from_account = prev.to_account
       AND created_at > prev.created_at
       AND created_at <= prev.created_at + p_time_window
     ```

---

## 4. Multi-Signal Mule Network Analysis (Objective O5)

### 4.1 `fn_get_mule_network_signals(BIGINT[])`
* **File:** `sql/07_mule_network_links.sql`
* **Signals Discovered:**
  1. `SHARED_DEVICE`: Joined across `account_devices` on identical `device_id`.
  2. `SHARED_PHONE`: Joined across `customer_phones` and `accounts` on identical `phone_id`.
  3. `SHARED_IP`: Joined across `account_ip_logs` on identical `ip_id`.
* Every returned record is categorized with `classification = 'INVESTIGATIVE_SIGNAL'` for human analyst review.

---

## 5. Cryptographic Audit Trail & Hash-Chain Verification (Objective O8)

### 5.1 `fn_append_audit_log`
* **Locking:** `PERFORM pg_advisory_xact_lock(999001);`
* **Genesis Hash:** `0000000000000000000000000000000000000000000000000000000000000000`
* **Hash Computation:**
  $$h_i = \text{SHA-256}(h_{i-1} \parallel \text{actor\_role} \parallel \text{action\_type} \parallel \text{target\_entity} \parallel \text{target\_id} \parallel \text{payload} \parallel \text{timestamp})$$

### 5.2 `fn_verify_audit_chain`
* Re-walks the audit table sequentially and recomputes all SHA-256 digests.
* Returns `is_valid BOOLEAN`, `total_checked INT`, `corrupted_audit_id BIGINT`, and `error_reason TEXT`.
