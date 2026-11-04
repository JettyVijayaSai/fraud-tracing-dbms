# PostgreSQL-Based Fraud Detection & Temporal Money Tracing System

> **DBMS Laboratory Experiential Learning Project**  
> **Department of Computer Science and Engineering, RV College of Engineering, Bengaluru**  
> Project Synopsis: *"PostgreSQL-Based Fraud Detection and Temporal Stolen-Money Tracing Across Mule-Account Networks"*

A database-centric financial intelligence and AML forensic system in which PostgreSQL acts as both the immutable system of record and the core analytical graph engine.

---

## 🏛️ System Architecture & Five Operational Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Transactional Layer: ACID Idempotency, Double-Entry Deferred Trigger    │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. Detection Layer: Window Analytics (Velocity, Outliers, Structuring,      │
│                     Mule Layering) + Real-Time LISTEN/NOTIFY Bus           │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. Tracing & Network Layer: WITH RECURSIVE Temporal Money Tracing           │
│                             (Haircut Rule) + Multi-Signal Link Analysis     │
├─────────────────────────────────────────────────────────────────────────────┤
│ 4. Investigation & Audit Layer: Dossier Workstation, Freeze/Clear Decisions, │
│                                 Advisory-Locked SHA-256 Hash Chain          │
├─────────────────────────────────────────────────────────────────────────────┤
│ 5. Evaluation Layer: 1M+ Transaction Synthetic Generator, 25 Fraud Rings,   │
│                      100-Way Concurrency Harness, EXPLAIN ANALYZE Plans     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quickstart & One-Command Execution

### 1. Start Tuned PostgreSQL 16 Container
```bash
docker compose up -d
```
*Tuned with `shared_buffers=512MB`, `work_mem=64MB`, and automated initialization from `sql/`.*

Alternatively, to run against local PostgreSQL, run:
```bash
psql -U postgres -d fraud_tracing_db -f sql/01_extensions_and_roles.sql
psql -U postgres -d fraud_tracing_db -f sql/02_schema_3nf.sql
psql -U postgres -d fraud_tracing_db -f sql/03_ledger_and_idempotency.sql
psql -U postgres -d fraud_tracing_db -f sql/04_audit_hash_chain.sql
psql -U postgres -d fraud_tracing_db -f sql/05_detection_rules.sql
psql -U postgres -d fraud_tracing_db -f sql/06_recursive_tracing.sql
psql -U postgres -d fraud_tracing_db -f sql/07_mule_network_links.sql
psql -U postgres -d fraud_tracing_db -f sql/08_security_rls_views.sql
psql -U postgres -d fraud_tracing_db -f sql/09_indexes.sql
```

---

### 2. Install Python Dependencies
```bash
cd backend
pip install -r requirements.txt
```

---

### 3. Generate Synthetic Benchmark & Planted Fraud Rings
Run high-speed ingestion (via PostgreSQL `COPY`):

**Smoke Test (100,000 transactions):**
```bash
python scripts/generate_synthetic_data.py --rows 100000
```

**Full Synopsis Benchmark (1,000,000 transactions):**
```bash
python scripts/generate_synthetic_data.py --rows 1000000
```
*Plants 25 ground-truth fraud rings (Account Takeover, Structuring, Velocity) and 25 benign look-alike patterns (Payroll splits, Family sharing, Merchant settlements).*

---

### 4. Run Concurrency, Idempotency & Audit Verification Harnesses

#### Objective O6: 100-Way Concurrent Double-Spend Test
```bash
python scripts/exp_concurrency_double_spend.py
```
*Contrasts Mode A (Vulnerable Read Committed), Mode B (`SELECT ... FOR UPDATE`), and Mode C (`SERIALIZABLE` + Exponential Backoff).*

#### Objectives O2, O7 & O8: Idempotency Replay & Cryptographic Tamper Test
```bash
python scripts/exp_idempotency_and_tamper.py
```
*Proves idempotent replay safety, 409 conflict handling, double-entry constraint abort on unbalanced transactions, and cryptographic SHA-256 tamper detection.*

#### Objective O9: Precision/Recall/F1 Evaluation & EXPLAIN ANALYZE Comparison
```bash
python scripts/exp_evaluate_and_explain.py
```
*Computes TP, FP, FN, Precision, Recall, F1 against `ground_truth_rings`, and measures query speedup before and after applying `09_indexes.sql`.*

---

### 5. Launch FastAPI Backend with Real-Time LISTEN/NOTIFY WebSocket
```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

---

### 6. Launch React + Cytoscape.js Investigator Dashboard
```bash
cd frontend
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 📂 Repository Layout

```text
fraud-tracing-dbms/
├── docker-compose.yml              # Tuned PostgreSQL 16 container definition
├── sql/
│   ├── 01_extensions_and_roles.sql # pgcrypto & RBAC roles
│   ├── 02_schema_3nf.sql           # 3NF relational schema
│   ├── 03_ledger_and_idempotency.sql # Deferred balance trigger & sp_process_payment
│   ├── 04_audit_hash_chain.sql     # Advisory-locked SHA-256 audit log & verify query
│   ├── 05_detection_rules.sql      # Anomaly detection views & LISTEN/NOTIFY trigger
│   ├── 06_recursive_tracing.sql    # WITH RECURSIVE temporal haircut attribution
│   ├── 07_mule_network_links.sql   # Shared Device, Phone, IP multi-signal joins
│   ├── 08_security_rls_views.sql   # RLS policies, masked views, audit immutability
│   └── 09_indexes.sql              # Composite B-tree indexes for fast traversal
├── backend/
│   ├── requirements.txt            # Python dependencies
│   ├── config.py                   # DB connection pool & configuration
│   ├── main.py                     # FastAPI app + LISTEN/NOTIFY WebSocket bridge
│   ├── routers/
│   │   ├── transactions.py         # Payment execution & account endpoints
│   │   ├── alerts_and_tracing.py   # Alerts, recursive money trails, mule signals
│   │   ├── cases_and_audit.py      # Case notes, freeze/clear actions, audit logs
│   │   └── metrics.py              # Precision/Recall/F1 & EXPLAIN ANALYZE endpoints
│   └── scripts/
│       ├── generate_synthetic_data.py # Ingestion & planted ground-truth rings
│       ├── exp_concurrency_double_spend.py # 100-way concurrent withdrawal test
│       ├── exp_idempotency_and_tamper.py   # Idempotency & audit tamper tests
│       └── exp_evaluate_and_explain.py     # Metrics calculator & plan comparison
├── frontend/                       # Vite + React + Tailwind + Cytoscape.js
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx                 # Investigator workstation tabbed interface
│       └── components/
│           ├── LiveAlertFeed.jsx       # Real-time LISTEN/NOTIFY WebSocket alert feed
│           ├── TemporalTraceGraph.jsx  # Cytoscape.js directed graph (haircut attribution)
│           ├── MuleNetworkPanel.jsx    # Device, Phone, IP multi-signal inspector
│           ├── CaseWorkstation.jsx     # Freeze/Clear actions & exact SQL evidence
│           ├── AuditVerifier.jsx       # Live SHA-256 chain verification & digest export
│           └── BenchmarkDashboard.jsx  # Precision/Recall/F1 & EXPLAIN plan viewer
└── docs/
    ├── ER_and_3NF_Decomposition.md # Mermaid ER diagram & lossless join proofs
    └── Query_Catalogue.md          # Complete documented SQL query catalogue
```

---

## 🔬 Literature Survey References Implemented

* **[1] FlowScope (AAAI 2020):** Multi-hop fund flow across intermediaries.
* **[4] Smurf-based AML (ECML PKDD 2021):** Relational time-window joins at scale.
* **[5] SQL Ledger (ACM SIGMOD 2021):** Cryptographic hash-chained audit verification.
* **[7] Ad Hoc Transactions (ACM SIGMOD 2022):** Eliminating race conditions via database-enforced row locks and serializable isolation.
* **[8] Synthetic AML Benchmarks (NeurIPS 2023):** Ground-truth evaluation methodology.
* **[10] SMoTeF (Applied Intelligence 2024):** Time-respecting path traversal and conservative amount attribution.
