import React, { useState, useEffect } from 'react';
import { ShieldCheck, ShieldAlert, RefreshCw, Download, Lock, CheckCircle2, AlertOctagon } from 'lucide-react';

export default function AuditVerifier() {
  const [verificationResult, setVerificationResult] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  const runVerification = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/audit/verify');
      if (res.ok) {
        const data = await res.json();
        setVerificationResult(data);
      }
      const logRes = await fetch('/api/audit/logs?limit=50');
      if (logRes.ok) {
        const logData = await logRes.json();
        setAuditLogs(logData);
      }
    } catch (e) {
      console.error("Verification failed:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runVerification();
  }, []);

  const exportDigest = () => {
    const exportData = {
      timestamp: new Date().toISOString(),
      verification: verificationResult,
      recent_digests: auditLogs.map(l => ({
        audit_id: l.audit_id,
        action: l.action_type,
        prev_hash: l.prev_hash,
        row_hash: l.row_hash,
        created_at: l.created_at
      }))
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-chain-digest-${Date.now()}.json`;
    a.click();
  };

  return (
    <div className="bg-cardbg border border-bordercolor rounded-xl flex flex-col h-[750px] overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-bordercolor flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-emerald-500" />
          <h2 className="font-bold text-gray-100">Cryptographic Audit Trail (SHA-256 Hash Chain)</h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportDigest}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium px-3 py-1.5 rounded-lg border border-bordercolor transition"
          >
            <Download className="w-3.5 h-3.5" />
            Export Digest Certificate
          </button>
          <button
            onClick={runVerification}
            disabled={loading}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Verify Chain Integrity
          </button>
        </div>
      </div>

      {/* Verification Status Banner */}
      {verificationResult && (
        <div className={`p-4 border-b ${verificationResult.is_valid ? 'bg-emerald-950/40 border-emerald-800/80' : 'bg-red-950/60 border-red-800'}`}>
          <div className="flex items-center gap-3">
            {verificationResult.is_valid ? (
              <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
            ) : (
              <AlertOctagon className="w-8 h-8 text-red-400 shrink-0" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className={`font-bold text-sm ${verificationResult.is_valid ? 'text-emerald-300' : 'text-red-300'}`}>
                  {verificationResult.is_valid ? 'MATHEMATICALLY VALID AUDIT CHAIN' : 'CORRUPTED OR TAMPERED AUDIT LOG DETECTED'}
                </span>
                <span className="text-xs bg-black/40 px-2 py-0.5 rounded text-gray-300 font-mono">
                  {verificationResult.total_checked} Records Verified
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {verificationResult.error_reason || 'Every entry is linked with advisory-locked SHA-256 digests. Zero mutations or dropped records detected.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Immutable Hash-Chained Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-gray-900/90 text-gray-400 sticky top-0 border-b border-bordercolor text-[11px]">
            <tr>
              <th className="p-2.5">ID</th>
              <th className="p-2.5">Role</th>
              <th className="p-2.5">Action</th>
              <th className="p-2.5">Target</th>
              <th className="p-2.5">Previous Digest (h_{'{i-1}'})</th>
              <th className="p-2.5">Current Row Hash (h_{'{i}'})</th>
              <th className="p-2.5">Timestamp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800 text-gray-300">
            {auditLogs.map((log) => (
              <tr key={log.audit_id} className="hover:bg-gray-800/50 transition">
                <td className="p-2.5 font-bold text-white">#{log.audit_id}</td>
                <td className="p-2.5 text-blue-400">{log.actor_role}</td>
                <td className="p-2.5 font-semibold text-amber-300">{log.action_type}</td>
                <td className="p-2.5 text-gray-400">{log.target_entity}:{log.target_id}</td>
                <td className="p-2.5 text-[10px] text-gray-500 max-w-[150px] truncate" title={log.prev_hash}>
                  {log.prev_hash.slice(0, 16)}...
                </td>
                <td className="p-2.5 text-[10px] text-emerald-400 font-bold max-w-[150px] truncate" title={log.row_hash}>
                  {log.row_hash.slice(0, 16)}...
                </td>
                <td className="p-2.5 text-[11px] text-gray-500">
                  {new Date(log.created_at).toLocaleTimeString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
