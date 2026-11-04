-- ============================================================================
-- 07_mule_network_links.sql
-- Multi-Signal Mule-Account Network Link Analysis (Device, Phone, IP)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. View: Accounts Sharing Physical Devices
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_shared_device_links AS
SELECT
    ad1.account_id AS source_account,
    ad2.account_id AS target_account,
    'SHARED_DEVICE'::VARCHAR(32) AS signal_type,
    d.fingerprint AS shared_identifier,
    jsonb_build_object(
        'device_id', d.device_id,
        'model', d.device_model,
        'os', d.os_version,
        'ad1_first_used', ad1.first_used_at,
        'ad2_first_used', ad2.first_used_at
    ) AS details,
    'INVESTIGATIVE_SIGNAL'::VARCHAR(32) AS classification
FROM account_devices ad1
JOIN account_devices ad2 ON ad1.device_id = ad2.device_id AND ad1.account_id < ad2.account_id
JOIN devices d ON ad1.device_id = d.device_id;

-- ----------------------------------------------------------------------------
-- 2. View: Accounts Linked via Customers Sharing Phone Numbers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_shared_phone_links AS
SELECT
    a1.account_id AS source_account,
    a2.account_id AS target_account,
    'SHARED_PHONE'::VARCHAR(32) AS signal_type,
    p.phone_number AS shared_identifier,
    jsonb_build_object(
        'phone_id', p.phone_id,
        'carrier', p.carrier,
        'customer_1', cp1.customer_id,
        'customer_2', cp2.customer_id
    ) AS details,
    'INVESTIGATIVE_SIGNAL'::VARCHAR(32) AS classification
FROM customer_phones cp1
JOIN customer_phones cp2 ON cp1.phone_id = cp2.phone_id AND cp1.customer_id < cp2.customer_id
JOIN phones p ON cp1.phone_id = p.phone_id
JOIN accounts a1 ON a1.customer_id = cp1.customer_id
JOIN accounts a2 ON a2.customer_id = cp2.customer_id;

-- ----------------------------------------------------------------------------
-- 3. View: Accounts Operating from the Same IP Address
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_shared_ip_links AS
SELECT
    ip1.account_id AS source_account,
    ip2.account_id AS target_account,
    'SHARED_IP'::VARCHAR(32) AS signal_type,
    host(ip.ip_address) AS shared_identifier,
    jsonb_build_object(
        'ip_id', ip.ip_id,
        'isp', ip.isp,
        'subnet', ip.subnet_prefix::text,
        'country', ip.country_code,
        'is_vpn_proxy', ip.is_proxy_or_vpn,
        'sample_log_time_1', ip1.logged_at,
        'sample_log_time_2', ip2.logged_at
    ) AS details,
    'INVESTIGATIVE_SIGNAL'::VARCHAR(32) AS classification
FROM account_ip_logs ip1
JOIN account_ip_logs ip2 ON ip1.ip_id = ip2.ip_id AND ip1.account_id < ip2.account_id
JOIN ip_addresses ip ON ip1.ip_id = ip.ip_id
GROUP BY ip1.account_id, ip2.account_id, ip.ip_address, ip.ip_id, ip.isp, ip.subnet_prefix, ip.country_code, ip.is_proxy_or_vpn, ip1.logged_at, ip2.logged_at;

-- ----------------------------------------------------------------------------
-- 4. Parameterized Link Analysis Function for Traced Account Subgraphs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_get_mule_network_signals(p_account_ids BIGINT[])
RETURNS TABLE (
    source_account BIGINT,
    target_account BIGINT,
    signal_type VARCHAR(32),
    shared_identifier TEXT,
    details JSONB,
    classification VARCHAR(32)
)
LANGUAGE sql
STABLE
AS $$
    -- Device links within target accounts
    SELECT source_account, target_account, signal_type, shared_identifier, details, classification
    FROM vw_shared_device_links
    WHERE source_account = ANY(p_account_ids) OR target_account = ANY(p_account_ids)

    UNION ALL

    -- Phone links within target accounts
    SELECT source_account, target_account, signal_type, shared_identifier, details, classification
    FROM vw_shared_phone_links
    WHERE source_account = ANY(p_account_ids) OR target_account = ANY(p_account_ids)

    UNION ALL

    -- IP links within target accounts
    SELECT source_account, target_account, signal_type, shared_identifier, details, classification
    FROM vw_shared_ip_links
    WHERE source_account = ANY(p_account_ids) OR target_account = ANY(p_account_ids);
$$;
