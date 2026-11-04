import React, { useState, useEffect } from 'react';
import { Briefcase, Snowflake, CheckCircle2, FileText, Send, Database, AlertTriangle, ShieldAlert } from 'lucide-react';
import { API_BASE } from '../apiConfig';

export default function CaseWorkstation({ selectedAlert, prefilledAccountId, onDecisionRecorded }) {
  const [cases, setCases] = useState([]);
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [caseDetails, setCaseDetails] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState('HIGH');
  const [noteText, setNoteText] = useState('');
  const [freezeRationale, setFreezeRationale] = useState('');
  const [targetAccount, setTargetAccount] = useState(prefilledAccountId || '');
  const [loading, setLoading] = useState(false);
  const [actionSuccess, setActionSuccess] = useState('');

  const fetchCases = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/cases`);
      if (res.ok) {
        const data = await res.json();
        setCases(data);
        if (data.length > 0 && !selectedCaseId) {
          setSelectedCaseId(data[0].case_id);
        }
      }
    } catch (e) {
      console.error("Fetch cases error:", e);
    }
  };

  const fetchCaseDetails = async (cid) => {
    if (!cid) return;
    try {
      const res = await fetch(`${API_BASE}/api/cases/${cid}`);
      if (res.ok) {
        const data = await res.json();
        setCaseDetails(data);
      }
    } catch (e) {
      console.error("Case details error:", e);
    }
  };

  useEffect(() => {
    fetchCases();
  }, []);

  useEffect(() => {
    if (selectedCaseId) {
      fetchCaseDetails(selectedCaseId);
    }
  }, [selectedCaseId]);

  useEffect(() => {
    if (prefilledAccountId) {
      setTargetAccount(prefilledAccountId);
    }
  }, [prefilledAccountId]);

  const handleCreateCase = async (e) => {
    e.preventDefault();
    if (!newTitle) return;
    setLoading(true);
    try {
      const payload = {
        case_title: newTitle,
        priority: newPriority,
        alert_ids: selectedAlert ? [selectedAlert.alert_id] : []
      };
      const res = await fetch(`${API_BASE}/api/cases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const created = await res.json();
        setNewTitle('');
        await fetchCases();
        setSelectedCaseId(created.case_id);
        setActionSuccess('Case created and alert attached.');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!noteText || !selectedCaseId) return;
    try {
      const res = await fetch(`${API_BASE}/api/cases/${selectedCaseId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note_text: noteText, author_role: 'investigator_role' })
      });
      if (res.ok) {
        setNoteText('');
        fetchCaseDetails(selectedCaseId);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDecision = async (decisionType) => {
    if (!targetAccount || !selectedCaseId || !freezeRationale) {
      alert("Please specify Target Account ID, Decision Rationale, and ensure a Case is selected.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/cases/${selectedCaseId}/decisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: parseInt(targetAccount, 10),
          decision_type: decisionType,
          rationale: freezeRationale,
          decided_by: 'investigator_user'
        })
      });
      if (res.ok) {
        setFreezeRationale('');
        setActionSuccess(`Account #${targetAccount} successfully ${decisionType}D. Audit hash-chain recorded.`);
        fetchCaseDetails(selectedCaseId);
        if (onDecisionRecorded) onDecisionRecorded();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-cardbg border border-bordercolor rounded-xl grid grid-cols-1 md:grid-cols-12 h-[750px] overflow-hidden">
      {/* Sidebar: Case Selector & Creator */}
      <div className="md:col-span-4 border-r border-bordercolor flex flex-col h-full bg-gray-900/30">
        <div className="p-4 border-b border-bordercolor">
          <div className="flex items-center gap-2 mb-3">
            <Briefcase className="w-5 h-5 text-blue-500" />
            <h2 className="font-bold text-gray-100">Investigation Cases</h2>
          </div>

          <form onSubmit={handleCreateCase} className="space-y-2 text-xs">
            <input
              type="text"
              placeholder="Case Dossier Title..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full bg-gray-800 border border-bordercolor text-gray-200 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500"
            />
            <div className="flex gap-2">
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value)}
                className="bg-gray-800 border border-bordercolor text-gray-300 rounded px-2 py-1 flex-1"
              >
                <option value="LOW">Priority: Low</option>
                <option value="MEDIUM">Priority: Medium</option>
                <option value="HIGH">Priority: High</option>
                <option value="CRITICAL">Priority: Critical</option>
              </select>
              <button
                type="submit"
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-500 text-white font-medium px-3 py-1 rounded transition"
              >
                + New Case
              </button>
            </div>
            {selectedAlert && (
              <p className="text-[11px] text-blue-400">
                Will link selected Alert #{selectedAlert.alert_id} (Account #{selectedAlert.account_id})
              </p>
            )}
          </form>
        </div>

        {/* Case List */}
        <div className="flex-1 overflow-y-auto divide-y divide-bordercolor">
          {cases.map((c) => (
            <div
              key={c.case_id}
              onClick={() => setSelectedCaseId(c.case_id)}
              className={`p-3 text-xs cursor-pointer transition hover:bg-gray-800/60 ${selectedCaseId === c.case_id ? 'bg-blue-950/40 border-l-4 border-blue-500' : ''}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-gray-200">#{c.case_id} {c.case_title}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.priority === 'CRITICAL' ? 'bg-red-900/60 text-red-300' : c.priority === 'HIGH' ? 'bg-amber-900/60 text-amber-300' : 'bg-gray-800 text-gray-400'}`}>
                  {c.priority}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-gray-400">
                <span>Status: {c.status}</span>
                <span>{c.total_alerts || 0} Alerts attached</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Dossier Workstation */}
      <div className="md:col-span-8 flex flex-col h-full overflow-y-auto p-4 space-y-4">
        {actionSuccess && (
          <div className="bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs p-2.5 rounded-lg flex items-center justify-between">
            <span>{actionSuccess}</span>
            <button onClick={() => setActionSuccess('')} className="text-emerald-400 hover:text-white font-bold ml-2">×</button>
          </div>
        )}

        {caseDetails ? (
          <>
            {/* Case Header */}
            <div className="bg-gray-900/80 border border-bordercolor rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-xs text-gray-400 font-mono">CASE #{caseDetails.case.case_id}</span>
                  <h3 className="text-lg font-bold text-white">{caseDetails.case.case_title}</h3>
                </div>
                <div className="text-right text-xs">
                  <div className="font-medium text-gray-300">Assigned: {caseDetails.case.assigned_to}</div>
                  <div className="text-gray-500">Created: {new Date(caseDetails.case.created_at).toLocaleString()}</div>
                </div>
              </div>

              {/* Exact SQL Evidence Viewer */}
              {caseDetails.alerts && caseDetails.alerts.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-800">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 mb-1.5">
                    <Database className="w-3.5 h-3.5" />
                    Exact SQL Detection Query & Row Evidence
                  </div>
                  {caseDetails.alerts.map((a) => (
                    <div key={a.alert_id} className="bg-gray-950 border border-gray-800 rounded p-2 text-xs font-mono text-gray-300 mb-2">
                      <div className="text-blue-400 text-[11px] mb-1">
                        Alert #{a.alert_id} • Rule: {a.rule_code} • Risk: {a.risk_score}
                      </div>
                      <code className="text-gray-400 block overflow-x-auto text-[11px] bg-black/40 p-1.5 rounded">
                        {a.evidence_query}
                      </code>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action Bar: Freeze / Clear Account */}
            <div className="bg-gray-900/80 border border-bordercolor rounded-xl p-4">
              <h4 className="text-xs font-bold text-gray-200 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-red-400" />
                Investigator Action & Account Decision
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2 text-xs">
                <div>
                  <label className="text-gray-400 block mb-1">Target Account ID</label>
                  <input
                    type="number"
                    value={targetAccount}
                    onChange={(e) => setTargetAccount(e.target.value)}
                    placeholder="Account #"
                    className="w-full bg-gray-950 border border-bordercolor text-gray-200 rounded px-2.5 py-1.5"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-gray-400 block mb-1">Legal / Forensic Rationale</label>
                  <input
                    type="text"
                    value={freezeRationale}
                    onChange={(e) => setFreezeRationale(e.target.value)}
                    placeholder="e.g. Account takeover mule receiving stolen funds on Hop 2"
                    className="w-full bg-gray-950 border border-bordercolor text-gray-200 rounded px-2.5 py-1.5"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleDecision('FREEZE')}
                  disabled={loading}
                  className="flex-1 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold py-2 rounded-lg flex items-center justify-center gap-1.5 transition"
                >
                  <Snowflake className="w-4 h-4" />
                  FREEZE Account (Append to Audit Hash-Chain)
                </button>
                <button
                  onClick={() => handleDecision('CLEAR')}
                  disabled={loading}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold py-2 rounded-lg flex items-center justify-center gap-1.5 transition"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  CLEAR Account (Mark Legitimate)
                </button>
              </div>
            </div>

            {/* Past Decisions & Notes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
              {/* Decisions History */}
              <div className="bg-gray-900/60 border border-bordercolor rounded-xl p-3 flex flex-col">
                <h4 className="text-xs font-bold text-gray-300 mb-2">Recorded Account Decisions</h4>
                <div className="space-y-2 flex-1 overflow-y-auto">
                  {caseDetails.decisions?.length === 0 ? (
                    <p className="text-xs text-gray-500 italic">No freeze or clear actions taken yet.</p>
                  ) : (
                    caseDetails.decisions?.map((d) => (
                      <div key={d.decision_id} className="bg-gray-950 border border-gray-800 rounded p-2 text-xs">
                        <div className="flex justify-between items-center mb-1">
                          <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${d.decision_type === 'FREEZE' ? 'bg-red-900/60 text-red-300' : 'bg-emerald-900/60 text-emerald-300'}`}>
                            {d.decision_type} ACCOUNT #{d.account_id}
                          </span>
                          <span className="text-[10px] text-gray-500">{new Date(d.decided_at).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-gray-300 text-[11px]">{d.rationale}</p>
                        <p className="text-[10px] text-gray-500 mt-1">Decided by: {d.decided_by}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Investigator Notes */}
              <div className="bg-gray-900/60 border border-bordercolor rounded-xl p-3 flex flex-col">
                <h4 className="text-xs font-bold text-gray-300 mb-2">Investigative Notes</h4>
                <div className="space-y-2 flex-1 overflow-y-auto mb-2">
                  {caseDetails.notes?.length === 0 ? (
                    <p className="text-xs text-gray-500 italic">No notes recorded.</p>
                  ) : (
                    caseDetails.notes?.map((n) => (
                      <div key={n.note_id} className="bg-gray-950 border border-gray-800 rounded p-2 text-xs">
                        <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                          <span className="font-semibold text-blue-400">{n.author_role}</span>
                          <span>{new Date(n.created_at).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-gray-300 text-[11px]">{n.note_text}</p>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={handleAddNote} className="flex gap-1.5 text-xs">
                  <input
                    type="text"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Log investigative findings..."
                    className="flex-1 bg-gray-950 border border-bordercolor text-gray-200 rounded px-2.5 py-1.5"
                  />
                  <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded">
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 text-xs">
            Select or create a case from the sidebar to inspect dossier.
          </div>
        )}
      </div>
    </div>
  );
}
