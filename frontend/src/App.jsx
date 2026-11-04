import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  GitBranch,
  Network,
  Briefcase,
  Lock,
  BarChart3,
  Database,
  Layers,
  ArrowRight
} from 'lucide-react';

import LiveAlertFeed from './components/LiveAlertFeed';
import TemporalTraceGraph from './components/TemporalTraceGraph';
import MuleNetworkPanel from './components/MuleNetworkPanel';
import CaseWorkstation from './components/CaseWorkstation';
import AuditVerifier from './components/AuditVerifier';
import BenchmarkDashboard from './components/BenchmarkDashboard';

export default function App() {
  const [activeTab, setActiveTab] = useState('tracing'); // 'alerts', 'tracing', 'mule', 'cases', 'audit', 'benchmark'
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [traceRootTxnId, setTraceRootTxnId] = useState(null);
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [systemStats, setSystemStats] = useState(null);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/metrics/system-stats');
      if (res.ok) {
        const data = await res.json();
        setSystemStats(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleSelectAlert = (alert) => {
    setSelectedAlert(alert);
    if (alert.txn_id) {
      setTraceRootTxnId(alert.txn_id);
    }
    if (alert.account_id) {
      setSelectedAccountId(alert.account_id);
    }
  };

  const handleTraceTxn = (txnId) => {
    setTraceRootTxnId(txnId);
    setActiveTab('tracing');
  };

  const handleSelectAccountFromGraph = (accId) => {
    setSelectedAccountId(accId);
  };

  return (
    <div className="min-h-screen bg-darkbg text-gray-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="border-b border-bordercolor bg-cardbg/80 backdrop-blur sticky top-0 z-50 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg text-white shadow-lg shadow-blue-500/20">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                PostgreSQL Fraud Detection & Temporal Money Tracing Engine
                <span className="text-[10px] bg-blue-950 text-blue-400 border border-blue-800 px-2 py-0.5 rounded font-mono font-normal">
                  DBMS Prototype
                </span>
              </h1>
              <p className="text-xs text-gray-400">
                Double-Entry Ledger • Recursive Haircut Attribution • SHA-256 Audit Chain
              </p>
            </div>
          </div>

          {/* System Volume Stats */}
          {systemStats && (
            <div className="hidden lg:flex items-center gap-6 text-xs font-mono">
              <div>
                <span className="text-gray-500 block text-[10px]">TRANSACTIONS</span>
                <span className="font-bold text-white">{Number(systemStats.total_transactions).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-[10px]">LEDGER ENTRIES</span>
                <span className="font-bold text-blue-400">{Number(systemStats.total_ledger_entries).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-[10px]">ALERTS</span>
                <span className="font-bold text-red-400">{Number(systemStats.total_alerts).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-[10px]">AUDIT ROWS</span>
                <span className="font-bold text-emerald-400">{Number(systemStats.total_audit_entries).toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        <nav className="flex gap-2 mt-4 text-xs font-medium border-t border-bordercolor/60 pt-2.5">
          <button
            onClick={() => setActiveTab('tracing')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition ${activeTab === 'tracing' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}`}
          >
            <GitBranch className="w-4 h-4" />
            Recursive Money Trail & Network
          </button>

          <button
            onClick={() => setActiveTab('alerts')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition ${activeTab === 'alerts' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}`}
          >
            <ShieldAlert className="w-4 h-4" />
            Live Alerts Feed
          </button>

          <button
            onClick={() => setActiveTab('mule')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition ${activeTab === 'mule' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}`}
          >
            <Network className="w-4 h-4" />
            Mule Multi-Signal Analysis
          </button>

          <button
            onClick={() => setActiveTab('cases')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition ${activeTab === 'cases' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}`}
          >
            <Briefcase className="w-4 h-4" />
            Case Workstation & Decisions
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition ${activeTab === 'audit' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}`}
          >
            <Lock className="w-4 h-4" />
            Cryptographic Audit Ledger
          </button>

          <button
            onClick={() => setActiveTab('benchmark')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition ${activeTab === 'benchmark' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}`}
          >
            <BarChart3 className="w-4 h-4" />
            Benchmark & EXPLAIN ANALYZE
          </button>
        </nav>
      </header>

      {/* Main Viewport */}
      <main className="flex-1 p-6 max-w-[1600px] w-full mx-auto">
        {activeTab === 'tracing' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-4">
              <LiveAlertFeed
                onSelectAlert={handleSelectAlert}
                onTraceTxn={handleTraceTxn}
                selectedAlertId={selectedAlert?.alert_id}
              />
            </div>
            <div className="lg:col-span-8">
              <TemporalTraceGraph
                rootTxnId={traceRootTxnId}
                onSelectAccount={handleSelectAccountFromGraph}
              />
            </div>
          </div>
        )}

        {activeTab === 'alerts' && (
          <LiveAlertFeed
            onSelectAlert={handleSelectAlert}
            onTraceTxn={handleTraceTxn}
            selectedAlertId={selectedAlert?.alert_id}
          />
        )}

        {activeTab === 'mule' && (
          <MuleNetworkPanel
            investigatedAccounts={selectedAccountId ? [selectedAccountId] : []}
          />
        )}

        {activeTab === 'cases' && (
          <CaseWorkstation
            selectedAlert={selectedAlert}
            prefilledAccountId={selectedAccountId}
            onDecisionRecorded={fetchStats}
          />
        )}

        {activeTab === 'audit' && (
          <AuditVerifier />
        )}

        {activeTab === 'benchmark' && (
          <BenchmarkDashboard />
        )}
      </main>
    </div>
  );
}
