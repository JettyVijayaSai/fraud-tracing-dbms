import React, { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Cpu, Gauge, Zap, CheckCircle, XCircle, RefreshCw, Terminal } from 'lucide-react';

export default function BenchmarkDashboard() {
  const [evalData, setEvalData] = useState(null);
  const [explainData, setExplainData] = useState(null);
  const [queryType, setQueryType] = useState('tracing');
  const [loading, setLoading] = useState(false);

  const fetchEvaluation = async () => {
    try {
      const res = await fetch('/api/metrics/evaluation');
      if (res.ok) {
        const data = await res.json();
        setEvalData(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchExplain = async (qType) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/metrics/explain?query_type=${qType}`);
      if (res.ok) {
        const data = await res.json();
        setExplainData(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvaluation();
    fetchExplain(queryType);
  }, []);

  const handleQueryTypeChange = (qt) => {
    setQueryType(qt);
    fetchExplain(qt);
  };

  return (
    <div className="bg-cardbg border border-bordercolor rounded-xl flex flex-col h-[750px] overflow-y-auto p-5 space-y-5">
      {/* KPI Cards: Precision, Recall, F1 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-500" />
            <h2 className="font-bold text-gray-100">Benchmark Evaluation Metrics (Objective O9)</h2>
          </div>
          <button
            onClick={fetchEvaluation}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh Metrics
          </button>
        </div>

        {evalData?.summary ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-gray-900/80 border border-bordercolor rounded-xl p-3.5">
              <span className="text-xs text-gray-400 block mb-1">Precision (TP / [TP+FP])</span>
              <div className="text-2xl font-bold text-emerald-400 font-mono">
                {(evalData.summary.precision * 100).toFixed(1)}%
              </div>
              <span className="text-[11px] text-gray-500">True fraud purity</span>
            </div>

            <div className="bg-gray-900/80 border border-bordercolor rounded-xl p-3.5">
              <span className="text-xs text-gray-400 block mb-1">Recall (TP / [TP+FN])</span>
              <div className="text-2xl font-bold text-blue-400 font-mono">
                {(evalData.summary.recall * 100).toFixed(1)}%
              </div>
              <span className="text-[11px] text-gray-500">Planted ring detection coverage</span>
            </div>

            <div className="bg-gray-900/80 border border-bordercolor rounded-xl p-3.5">
              <span className="text-xs text-gray-400 block mb-1">F1-Score (Harmonic Mean)</span>
              <div className="text-2xl font-bold text-purple-400 font-mono">
                {(evalData.summary.f1_score * 100).toFixed(1)}%
              </div>
              <span className="text-[11px] text-gray-500">Balance of precision & recall</span>
            </div>

            <div className="bg-gray-900/80 border border-bordercolor rounded-xl p-3.5">
              <span className="text-xs text-gray-400 block mb-1">Confusion Counts</span>
              <div className="text-xs font-mono text-gray-300 space-y-0.5 mt-1">
                <div>TP: <span className="text-emerald-400 font-bold">{evalData.summary.true_positives}</span> | FP: <span className="text-red-400 font-bold">{evalData.summary.false_positives}</span></div>
                <div>FN: <span className="text-amber-400 font-bold">{evalData.summary.false_negatives}</span> | TN: <span className="text-gray-400 font-bold">{evalData.summary.true_negatives}</span></div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-gray-900/50 border border-bordercolor rounded-xl text-xs text-gray-400">
            No ground truth evaluation data loaded yet. Run <code className="text-blue-400">python scripts/generate_synthetic_data.py</code> to populate benchmark.
          </div>
        )}
      </div>

      {/* Typology Ring Breakdown */}
      {evalData?.breakdown_by_pattern && (
        <div className="bg-gray-900/60 border border-bordercolor rounded-xl p-4">
          <h3 className="text-xs font-bold text-gray-200 uppercase tracking-wider mb-2">
            Planted Ground-Truth Typology Breakdown
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="text-gray-500 border-b border-gray-800 text-[11px]">
                <tr>
                  <th className="pb-2">Pattern Typology</th>
                  <th className="pb-2">Ground Truth Class</th>
                  <th className="pb-2 text-right">Planted Rings</th>
                  <th className="pb-2 text-right">Transactions</th>
                  <th className="pb-2 text-right">Alerted</th>
                  <th className="pb-2 text-right">Detection Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60 text-gray-300">
                {evalData.breakdown_by_pattern.map((b, i) => (
                  <tr key={i}>
                    <td className="py-2 font-semibold text-white">{b.ring_type}</td>
                    <td className="py-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] ${b.is_fraud ? 'bg-red-950 text-red-400 border border-red-800' : 'bg-emerald-950 text-emerald-400 border border-emerald-800'}`}>
                        {b.is_fraud ? 'FRAUD' : 'BENIGN'}
                      </span>
                    </td>
                    <td className="py-2 text-right">{b.total_rings}</td>
                    <td className="py-2 text-right">{b.total_transactions}</td>
                    <td className="py-2 text-right font-bold text-blue-400">{b.alerted_transactions}</td>
                    <td className="py-2 text-right font-bold text-emerald-400">
                      {b.total_transactions > 0 ? ((b.alerted_transactions / b.total_transactions) * 100).toFixed(1) : 0}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* EXPLAIN (ANALYZE, BUFFERS) Plan Inspector */}
      <div className="bg-gray-900/60 border border-bordercolor rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-amber-500" />
            <h3 className="font-bold text-gray-100 text-sm">PostgreSQL EXPLAIN (ANALYZE, BUFFERS) Query Plan Inspector</h3>
          </div>

          <div className="flex gap-1.5 text-xs">
            {['tracing', 'velocity', 'structuring', 'mule'].map((t) => (
              <button
                key={t}
                onClick={() => handleQueryTypeChange(t)}
                className={`px-3 py-1 rounded transition font-medium capitalize ${queryType === t ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {explainData ? (
          <div>
            <div className="bg-gray-950 p-2.5 rounded border border-gray-800 font-mono text-[11px] text-gray-400 mb-3 overflow-x-auto">
              <span className="text-amber-400 font-bold">SQL Analyzed:</span> {explainData.sql_analyzed}
            </div>

            <div className="bg-black/80 p-3 rounded border border-gray-800 font-mono text-[11px] text-emerald-400 overflow-x-auto max-h-48">
              <pre>{JSON.stringify(explainData.execution_plan, null, 2)}</pre>
            </div>
          </div>
        ) : (
          <div className="text-xs text-gray-500 italic py-4 text-center">Loading execution plan...</div>
        )}
      </div>

      {/* 100-Way Concurrency Verification Summary */}
      <div className="bg-gray-900/60 border border-bordercolor rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Cpu className="w-5 h-5 text-purple-400" />
          <h3 className="font-bold text-gray-100 text-sm">Concurrency & Double-Spend Invariant Summary (O6)</h3>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          100 parallel withdrawal attempts ($100 each) on an account initialized with $1,000.00:
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="bg-red-950/30 border border-red-900/60 rounded-lg p-3">
            <span className="font-bold text-red-400 block mb-1">Mode A: Read Committed (Ad-Hoc App Logic)</span>
            <p className="text-gray-400 text-[11px] mb-2">Non-locking check-then-act allows parallel transactions to read stale balance.</p>
            <span className="bg-red-900/60 text-red-200 px-2 py-0.5 rounded text-[10px] font-bold">DOUBLE SPEND OCCURS (Violated)</span>
          </div>

          <div className="bg-emerald-950/30 border border-emerald-900/60 rounded-lg p-3">
            <span className="font-bold text-emerald-400 block mb-1">Mode B: Row-Level Locking (FOR UPDATE)</span>
            <p className="text-gray-400 text-[11px] mb-2">Exclusive tuple lock serializes balance deductions. Exactly 10 succeed, 90 rejected.</p>
            <span className="bg-emerald-900/60 text-emerald-200 px-2 py-0.5 rounded text-[10px] font-bold">PRESERVED (Zero Overdraft)</span>
          </div>

          <div className="bg-blue-950/30 border border-blue-900/60 rounded-lg p-3">
            <span className="font-bold text-blue-400 block mb-1">Mode C: SERIALIZABLE + Retry</span>
            <p className="text-gray-400 text-[11px] mb-2">PostgreSQL SSI detects rw-antidependencies and enforces mathematical serializability.</p>
            <span className="bg-blue-900/60 text-blue-200 px-2 py-0.5 rounded text-[10px] font-bold">PRESERVED (Zero Overdraft)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
