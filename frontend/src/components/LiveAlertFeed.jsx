import React, { useState, useEffect } from 'react';
import { AlertTriangle, Play, RefreshCw, Filter, ShieldAlert, Zap, ArrowRight } from 'lucide-react';

export default function LiveAlertFeed({ onSelectAlert, onTraceTxn, selectedAlertId }) {
  const [alerts, setAlerts] = useState([]);
  const [filterRule, setFilterRule] = useState('');
  const [minRisk, setMinRisk] = useState(50);
  const [loading, setLoading] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      let url = `/api/alerts?min_risk=${minRisk}&limit=100`;
      if (filterRule) url += `&rule_code=${filterRule}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setAlerts(data);
      }
    } catch (err) {
      console.error("Failed to fetch alerts:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();

    // WebSocket connection to PostgreSQL LISTEN/NOTIFY channel
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/alerts`;
    let ws;

    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => setWsConnected(false);
      ws.onerror = () => setWsConnected(false);
      ws.onmessage = (event) => {
        try {
          const newAlert = JSON.parse(event.data);
          setAlerts(prev => [newAlert, ...prev.slice(0, 99)]);
        } catch (e) {
          console.error("Error parsing WS alert:", e);
        }
      };
    } catch (e) {
      console.warn("WebSocket connect error:", e);
    }

    return () => {
      if (ws) ws.close();
    };
  }, [filterRule, minRisk]);

  const handleSweep = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/alerts/sweep', { method: 'POST' });
      if (res.ok) {
        await fetchAlerts();
      }
    } catch (err) {
      console.error("Sweep error:", err);
    } finally {
      setLoading(false);
    }
  };

  const getRuleBadge = (code) => {
    switch (code) {
      case 'RAPID_PASS_THROUGH':
        return <span className="bg-purple-900/60 text-purple-300 border border-purple-700 px-2 py-0.5 rounded text-xs font-semibold">Mule Layering</span>;
      case 'STRUCTURING_SMURFING':
        return <span className="bg-amber-900/60 text-amber-300 border border-amber-700 px-2 py-0.5 rounded text-xs font-semibold">Smurfing / Structuring</span>;
      case 'VELOCITY_BURST':
        return <span className="bg-red-900/60 text-red-300 border border-red-700 px-2 py-0.5 rounded text-xs font-semibold">Velocity Burst</span>;
      case 'AMOUNT_ZSCORE_OUTLIER':
        return <span className="bg-blue-900/60 text-blue-300 border border-blue-700 px-2 py-0.5 rounded text-xs font-semibold">Z-Score Outlier</span>;
      default:
        return <span className="bg-gray-800 text-gray-300 px-2 py-0.5 rounded text-xs">{code}</span>;
    }
  };

  return (
    <div className="bg-cardbg border border-bordercolor rounded-xl flex flex-col h-[750px]">
      {/* Header */}
      <div className="p-4 border-b border-bordercolor flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-red-500" />
          <h2 className="font-bold text-gray-100">Live Fraud Alert Feed</h2>
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${wsConnected ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-red-950 text-red-400 border border-red-800'}`}>
            <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`}></span>
            {wsConnected ? 'LISTEN/NOTIFY LIVE' : 'WS OFFLINE'}
          </span>
        </div>

        <button
          onClick={handleSweep}
          disabled={loading}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition"
        >
          <Play className="w-3.5 h-3.5" />
          Trigger Anomaly Sweep
        </button>
      </div>

      {/* Filter Bar */}
      <div className="p-3 bg-gray-900/50 border-b border-bordercolor flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5 text-gray-400">
          <Filter className="w-3.5 h-3.5" />
          <span>Filter:</span>
        </div>

        <select
          value={filterRule}
          onChange={(e) => setFilterRule(e.target.value)}
          className="bg-gray-800 border border-bordercolor text-gray-200 rounded px-2.5 py-1 focus:outline-none focus:border-blue-500"
        >
          <option value="">All Fraud Typologies</option>
          <option value="RAPID_PASS_THROUGH">Rapid Pass-Through (Mule Layering)</option>
          <option value="STRUCTURING_SMURFING">Structuring / Smurfing</option>
          <option value="VELOCITY_BURST">Velocity Burst</option>
          <option value="AMOUNT_ZSCORE_OUTLIER">Amount Z-Score Outlier</option>
        </select>

        <div className="flex items-center gap-2 text-gray-400 ml-auto">
          <span>Min Risk Score:</span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={minRisk}
            onChange={(e) => setMinRisk(Number(e.target.value))}
            className="w-24 accent-blue-500"
          />
          <span className="font-mono text-gray-200">{minRisk}+</span>
        </div>

        <button
          onClick={fetchAlerts}
          className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition"
          title="Refresh Alerts"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Alert List */}
      <div className="flex-1 overflow-y-auto divide-y divide-bordercolor">
        {alerts.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Zap className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No alerts found matching criteria.</p>
            <p className="text-xs mt-1">Generate synthetic data or click "Trigger Anomaly Sweep".</p>
          </div>
        ) : (
          alerts.map((al) => {
            const isSelected = selectedAlertId === al.alert_id;
            return (
              <div
                key={al.alert_id}
                onClick={() => onSelectAlert(al)}
                className={`p-3.5 transition cursor-pointer hover:bg-gray-800/60 ${isSelected ? 'bg-blue-950/40 border-l-4 border-blue-500' : ''}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gray-400">#{al.alert_id}</span>
                    {getRuleBadge(al.rule_code)}
                  </div>
                  <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded ${al.risk_score >= 80 ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'}`}>
                    Risk: {al.risk_score}
                  </span>
                </div>

                <div className="text-xs text-gray-300 font-medium mb-1">
                  Account #{al.account_id} {al.amount ? `• Transfer: $${Number(al.amount).toLocaleString(undefined, {minimumFractionDigits: 2})}` : ''}
                </div>

                <p className="text-xs text-gray-400 line-clamp-2 mb-2 font-mono bg-gray-900/60 p-1.5 rounded border border-gray-800">
                  {al.explanation?.flag_reason || JSON.stringify(al.explanation)}
                </p>

                <div className="flex items-center justify-between text-[11px] text-gray-500">
                  <span>{new Date(al.created_at).toLocaleTimeString()}</span>
                  {al.txn_id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTraceTxn(al.txn_id);
                      }}
                      className="flex items-center gap-1 text-blue-400 hover:text-blue-300 font-semibold"
                    >
                      Trace Fund Flow <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
