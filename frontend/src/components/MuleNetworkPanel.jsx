import React, { useState } from 'react';
import { Smartphone, Phone, Globe, Info, Search, ShieldCheck } from 'lucide-react';

export default function MuleNetworkPanel({ investigatedAccounts = [] }) {
  const [accountInput, setAccountInput] = useState(investigatedAccounts.join(', '));
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState('ALL');

  const querySignals = async () => {
    const rawIds = accountInput.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (rawIds.length === 0) return;

    setLoading(true);
    try {
      const res = await fetch('/api/mule-signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_ids: rawIds })
      });
      if (res.ok) {
        const data = await res.json();
        setSignals(data.signals);
      }
    } catch (e) {
      console.error("Failed to query signals:", e);
    } finally {
      setLoading(false);
    }
  };

  const filteredSignals = signals.filter(s => {
    if (filterType === 'ALL') return true;
    return s.signal_type === filterType;
  });

  const getSignalIcon = (type) => {
    switch (type) {
      case 'SHARED_DEVICE':
        return <Smartphone className="w-4 h-4 text-purple-400" />;
      case 'SHARED_PHONE':
        return <Phone className="w-4 h-4 text-emerald-400" />;
      case 'SHARED_IP':
        return <Globe className="w-4 h-4 text-blue-400" />;
      default:
        return <Info className="w-4 h-4 text-gray-400" />;
    }
  };

  return (
    <div className="bg-cardbg border border-bordercolor rounded-xl flex flex-col h-[750px]">
      {/* Header */}
      <div className="p-4 border-b border-bordercolor">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-purple-500" />
            <h2 className="font-bold text-gray-100">Mule Network Link Analysis</h2>
          </div>
          <span className="text-[11px] bg-amber-950/60 text-amber-300 border border-amber-800/80 px-2 py-0.5 rounded flex items-center gap-1">
            <Info className="w-3 h-3" /> Investigative Signal Only
          </span>
        </div>

        <p className="text-xs text-gray-400 mb-3">
          Uncovers hidden mule clusters and syndicates operating across shared physical devices, phone numbers, and IP subnets.
        </p>

        {/* Search input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={accountInput}
            onChange={(e) => setAccountInput(e.target.value)}
            placeholder="Account IDs (e.g. 101, 102, 103)"
            className="flex-1 bg-gray-900 border border-bordercolor text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-purple-500"
          />
          <button
            onClick={querySignals}
            disabled={loading}
            className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 transition"
          >
            <Search className="w-3.5 h-3.5" />
            Scan Graph
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="px-4 py-2 bg-gray-900/50 border-b border-bordercolor flex gap-2 text-xs">
        {['ALL', 'SHARED_DEVICE', 'SHARED_PHONE', 'SHARED_IP'].map(type => (
          <button
            key={type}
            onClick={() => setFilterType(type)}
            className={`px-2.5 py-1 rounded font-medium transition ${filterType === type ? 'bg-purple-900/50 text-purple-200 border border-purple-700' : 'text-gray-400 hover:text-white'}`}
          >
            {type.replace('SHARED_', '')}
          </button>
        ))}
      </div>

      {/* Signal Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredSignals.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-xs">
            <ShieldCheck className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>No multi-signal links found for specified accounts.</p>
            <p className="mt-1">Enter account numbers from the fraud trail to detect shared hardware and network identifiers.</p>
          </div>
        ) : (
          filteredSignals.map((s, idx) => (
            <div key={idx} className="bg-gray-900/80 border border-bordercolor rounded-lg p-3 text-xs">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  {getSignalIcon(s.signal_type)}
                  <span className="font-semibold text-gray-200">{s.signal_type}</span>
                </div>
                <span className="text-[10px] text-gray-400 font-mono bg-gray-800 px-1.5 py-0.5 rounded">
                  {s.classification}
                </span>
              </div>

              <div className="text-gray-300 mb-2">
                Links <strong className="text-blue-400">Account #{s.source_account}</strong> ↔ <strong className="text-blue-400">Account #{s.target_account}</strong>
              </div>

              <div className="bg-gray-950 p-2 rounded border border-gray-800 font-mono text-[11px] text-gray-400">
                <div><span className="text-gray-500">Shared Identifier:</span> {s.shared_identifier}</div>
                {s.details && (
                  <pre className="mt-1 text-[10px] text-gray-500 overflow-x-auto">
                    {JSON.stringify(s.details, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
