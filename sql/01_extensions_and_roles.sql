-- ============================================================================
-- 01_extensions_and_roles.sql
-- Extensions and Role-Based Access Control (RBAC) Setup
-- ============================================================================

-- Enable pgcrypto for cryptographic digest calculation (SHA-256 for audit hash-chains)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Helper to safely create roles if they do not exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_role') THEN
        CREATE ROLE app_role WITH NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'analyst_role') THEN
        CREATE ROLE analyst_role WITH NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'investigator_role') THEN
        CREATE ROLE investigator_role WITH NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'auditor_role') THEN
        CREATE ROLE auditor_role WITH NOLOGIN;
    END IF;

    -- Operational application user
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'payment_app_user') THEN
        CREATE ROLE payment_app_user WITH LOGIN PASSWORD 'app_secure_password';
        GRANT app_role TO payment_app_user;
    END IF;

    -- Fraud analyst user
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'fraud_analyst_user') THEN
        CREATE ROLE fraud_analyst_user WITH LOGIN PASSWORD 'analyst_secure_password';
        GRANT analyst_role TO fraud_analyst_user;
    END IF;

    -- Senior investigator user
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'investigator_user') THEN
        CREATE ROLE investigator_user WITH LOGIN PASSWORD 'investigator_secure_password';
        GRANT investigator_role TO investigator_user;
    END IF;

    -- Independent compliance auditor user
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'compliance_auditor_user') THEN
        CREATE ROLE compliance_auditor_user WITH LOGIN PASSWORD 'auditor_secure_password';
        GRANT auditor_role TO compliance_auditor_user;
    END IF;
END $$;
