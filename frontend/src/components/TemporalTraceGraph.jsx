import React, { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { GitBranch, Clock, DollarSign, Layers, AlertCircle, RefreshCw, Smartphone, Phone, Globe } from 'lucide-react';

cytoscape.use(dagre);

export default function TemporalTraceGraph({ rootTxnId, onSelectAccount }) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [trailSummary, setTrailSummary] = useState(null);
  const [muleSignals, setMuleSignals] = useState([]);
  const [showMuleOverlay, setShowMuleOverlay] = useState(true);
  const [selectedNodeData, setSelectedNodeData] = useState(null);
  const [hoursWindow, setHoursWindow] = useState(48);
  const [maxHops, setMaxHops] = useState(6);

  const loadGraph = async () => {
    if (!rootTxnId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/trace/${rootTxnId}?hours=${hoursWindow}&max_hops=${maxHops}`);
      if (!res.ok) throw new Error("Failed to trace transaction");
      const data = await res.json();
      setTrailSummary(data.traversal_summary);

      // Collect account IDs for mule signal query
      const accountIds = data.graph.nodes.map(n => n.account_id);
      let signals = [];
      if (accountIds.length > 0) {
        const sigRes = await fetch('/api/mule-signals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_ids: accountIds })
        });
        if (sigRes.ok) {
          const sigData = await sigRes.json();
          signals = sigData.signals;
          setMuleSignals(signals);
        }
      }

      renderCytoscape(data.graph, signals);
    } catch (err) {
      console.error("Tracing error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGraph();
  }, [rootTxnId, hoursWindow, maxHops]);

  const renderCytoscape = (graph, signals) => {
    if (!containerRef.current) return;

    if (cyRef.current) {
      cyRef.current.destroy();
    }

    const elements = [];

    // Add Nodes
    graph.nodes.forEach(n => {
      elements.push({
        data: {
          id: n.id,
          label: `Acc #${n.account_id}\n(Hop ${n.hop})`,
          account_id: n.account_id,
          type: n.type,
          hop: n.hop
        }
      });
    });

    // Add Temporal Transfer Edges
    graph.edges.forEach(e => {
      elements.push({
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          label: `$${e.attributed_amount.toLocaleString()} (Hop ${e.hop_depth})`,
          txn_amount: e.txn_amount,
          attributed_amount: e.attributed_amount,
          created_at: e.created_at,
          is_temporal: true
        }
      });
    });

    // Add Mule Network Signals (Dashed edges)
    if (showMuleOverlay && signals) {
      signals.forEach((s, idx) => {
        const srcNode = `acc_${s.source_account}`;
        const tgtNode = `acc_${s.target_account}`;
        // Only render if both endpoints are in graph
        if (graph.nodes.some(n => n.id === srcNode) && graph.nodes.some(n => n.id === tgtNode)) {
          elements.push({
            data: {
              id: `signal_${idx}`,
              source: srcNode,
              target: tgtNode,
              label: s.signal_type.replace('SHARED_', ''),
              signal_type: s.signal_type,
              is_signal: true,
              identifier: s.shared_identifier
            }
          });
        }
      });
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements: elements,
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'color': '#ffffff',
            'font-size': '10px',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'width': 54,
            'height': 54,
            'border-width': 2,
            'border-color': '#3b82f6',
            'background-color': '#1e293b'
          }
        },
        {
          selector: 'node[type = "VICTIM"]',
          style: {
            'background-color': '#065f46',
            'border-color': '#10b981'
          }
        },
        {
          selector: 'node[type = "DESTINATION"]',
          style: {
            'background-color': '#7f1d1d',
            'border-color': '#ef4444'
          }
        },
        {
          selector: 'edge[is_temporal]',
          style: {
            'label': 'data(label)',
            'color': '#94a3b8',
            'font-size': '9px',
            'width': 3,
            'line-color': '#3b82f6',
            'target-arrow-color': '#3b82f6',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'text-background-color': '#0f172a',
            'text-background-opacity': 0.8,
            'text-background-padding': '2px'
          }
        },
        {
          selector: 'edge[is_signal]',
          style: {
            'label': 'data(label)',
            'color': '#fbbf24',
            'font-size': '8px',
            'width': 2,
            'line-color': '#f59e0b',
            'line-style': 'dashed',
            'target-arrow-shape': 'none',
            'curve-style': 'bezier'
          }
        },
        {
          selector: ':selected',
          style: {
            'border-width': 4,
            'border-color': '#fbbf24'
          }
        }
      ],
      layout: {
        name: 'dagre',
        rankDir: 'LR',
        nodeSep: 60,
        rankSep: 90
      }
    });

    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      setSelectedNodeData(node.data());
      if (onSelectAccount) {
        onSelectAccount(node.data('account_id'));
      }
    });

    cyRef.current = cy;
  };

  return (
    <div className="bg-cardbg border border-bordercolor rounded-xl flex flex-col h-[750px] relative overflow-hidden">
      {/* Control Header */}
      <div className="p-4 border-b border-bordercolor flex items-center justify-between bg-gray-900/40">
        <div className="flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-blue-500" />
          <h2 className="font-bold text-gray-100">Recursive Temporal Money Trail</h2>
          {rootTxnId && <span className="text-xs font-mono text-gray-400 bg-gray-800 px-2 py-0.5 rounded">Root Txn #{rootTxnId}</span>}
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 text-gray-400">
            <Clock className="w-3.5 h-3.5" />
            <span>Window:</span>
            <select
              value={hoursWindow}
              onChange={(e) => setHoursWindow(Number(e.target.value))}
              className="bg-gray-800 border border-bordercolor text-gray-200 rounded px-2 py-1"
            >
              <option value={12}>12 Hours</option>
              <option value={24}>24 Hours</option>
              <option value={48}>48 Hours (Default)</option>
              <option value={72}>72 Hours</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-gray-400">
            <Layers className="w-3.5 h-3.5" />
            <span>Max Hops:</span>
            <select
              value={maxHops}
              onChange={(e) => setMaxHops(Number(e.target.value))}
              className="bg-gray-800 border border-bordercolor text-gray-200 rounded px-2 py-1"
            >
              <option value={3}>3 Hops</option>
              <option value={6}>6 Hops</option>
              <option value={10}>10 Hops</option>
            </select>
          </div>

          <label className="flex items-center gap-1.5 text-amber-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showMuleOverlay}
              onChange={(e) => setShowMuleOverlay(e.target.checked)}
              className="accent-amber-500"
            />
            <span>Mule Links Overlay</span>
          </label>

          <button
            onClick={loadGraph}
            className="p-1.5 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Summary KPI Bar */}
      {trailSummary && (
        <div className="bg-gray-900/80 px-4 py-2 border-b border-bordercolor flex items-center justify-between text-xs">
          <div className="flex items-center gap-6">
            <span className="text-gray-400">Total Hops Traversed: <strong className="text-white">{trailSummary.total_hops}</strong></span>
            <span className="text-gray-400">Total Layering Transfers: <strong className="text-blue-400">{trailSummary.total_transfers}</strong></span>
            <span className="text-gray-400">Accounts Implicated: <strong className="text-amber-400">{trailSummary.unique_accounts}</strong></span>
            <span className="text-gray-400">Shared Mule Signals: <strong className="text-purple-400">{muleSignals.length}</strong></span>
          </div>

          <div className="flex items-center gap-4 text-[11px]">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-emerald-500 inline-block"></span> Victim Account</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-blue-500 inline-block"></span> Mule Hop</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-500 inline-block"></span> Cashout / Destination</span>
            <span className="flex items-center gap-1 text-amber-400">--- Shared Signal Link</span>
          </div>
        </div>
      )}

      {/* Cytoscape Canvas */}
      <div className="flex-1 w-full h-full relative">
        <div ref={containerRef} className="w-full h-full bg-[#070b13]" />

        {loading && (
          <div className="absolute inset-0 bg-darkbg/80 flex items-center justify-center gap-2 text-sm text-gray-300">
            <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
            <span>Computing recursive temporal haircut attribution in PostgreSQL...</span>
          </div>
        )}

        {!rootTxnId && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
            <GitBranch className="w-12 h-12 opacity-20 mb-3" />
            <p className="text-sm font-medium">Select an alert or enter a Root Transaction ID to trace.</p>
            <p className="text-xs mt-1">WITH RECURSIVE computes hop depth and conservative fund attribution.</p>
          </div>
        )}

        {/* Selected Node Inspector Drawer */}
        {selectedNodeData && (
          <div className="absolute top-4 right-4 w-72 bg-gray-900/95 border border-bordercolor rounded-xl p-4 shadow-xl backdrop-blur text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-gray-800 mb-2">
              <span className="font-bold text-white">Account #{selectedNodeData.account_id}</span>
              <span className="bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded text-[10px] uppercase font-semibold">
                Hop {selectedNodeData.hop}
              </span>
            </div>
            <div className="space-y-1.5 text-gray-300">
              <p><span className="text-gray-500">Role:</span> {selectedNodeData.type}</p>
              <p><span className="text-gray-500">Node ID:</span> {selectedNodeData.id}</p>
            </div>
            <div className="mt-3 pt-2 border-t border-gray-800 flex gap-2">
              <button
                onClick={() => onSelectAccount(selectedNodeData.account_id)}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-1.5 rounded transition"
              >
                Inspect in Case Workstation
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
