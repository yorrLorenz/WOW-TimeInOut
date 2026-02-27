import { useState, useEffect, useCallback, useRef } from 'react';
import { useBranch } from '../context/BranchContext';
import {
  getAllEmployees,
  getEmployeesByBranch,
  deleteEmployee,
  saveEmployee,
  getAllLogs,
  getLogsByDate,
  addLog,
  saveLog,
  deleteLog,
  todayDateString,
  getEmployee,
  getAllBranches,
  saveBranch,
  deleteBranch,
} from '../lib/db';
import { getAppsScriptUrl, saveAppsScriptUrl, bulkPushLogsToSheets, calcDuration } from '../lib/sheets';
import { useCamera } from '../hooks/useCamera';
import CameraView from '../components/CameraView';
import { loadModels, detectSingleFaceDescriptor, descriptorToArray } from '../lib/faceApi';

const CAPTURE_COUNT = 5;

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Running time (live elapsed for "present" employees) ───────────────────────

function ElapsedTime({ timeIn }) {
  function getElapsed() {
    const ms = Date.now() - new Date(timeIn).getTime();
    if (ms < 0) return '—';
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h}h ${m}m`;
  }
  const [elapsed, setElapsed] = useState(getElapsed);
  useEffect(() => {
    const t = setInterval(() => setElapsed(getElapsed()), 30_000);
    return () => clearInterval(t);
  }, [timeIn]);
  return (
    <span className="text-xs font-semibold text-brand">▶ {elapsed}</span>
  );
}

// ── Shared Empty State ────────────────────────────────────────────────────────

function EmptyState({ icon = '📋', message }) {
  return (
    <div className="text-center py-12">
      <div className="text-4xl mb-2">{icon}</div>
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  );
}

// ── Face Update Modal ─────────────────────────────────────────────────────────

function FaceUpdateModal({ employee, onClose, onSaved }) {
  const { videoRef, ready, error } = useCamera();
  const canvasRef = useRef(null);
  const [modelsReady, setModelsReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captures, setCaptures] = useState([]);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadModels().then(() => setModelsReady(true));
  }, []);

  async function handleCapture() {
    setCapturing(true);
    setStatus('Capturing face samples…');
    const newCaptures = [];
    for (let i = 0; i < CAPTURE_COUNT; i++) {
      setStatus(`Capturing sample ${i + 1} of ${CAPTURE_COUNT}…`);
      await new Promise((r) => setTimeout(r, 600));
      if (!videoRef.current) break;
      const detection = await detectSingleFaceDescriptor(videoRef.current);
      if (!detection) {
        setStatus('No face detected — try again with better lighting.');
        setCapturing(false);
        return;
      }
      newCaptures.push(descriptorToArray(detection.descriptor));
    }
    setCaptures((prev) => [...prev, ...newCaptures]);
    setStatus(
      `${captures.length + newCaptures.length} samples captured. ${
        captures.length + newCaptures.length >= 3 ? 'Click "Save" to update.' : 'Capture more samples.'
      }`
    );
    setCapturing(false);
  }

  async function handleSave() {
    if (captures.length < 3) { setStatus('Capture at least 3 samples first.'); return; }
    setSaving(true);
    try {
      await saveEmployee({ ...employee, descriptors: captures });
      onSaved();
      onClose();
    } catch (err) {
      setStatus('Save failed: ' + err.message);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-800">Update Face — {employee.name}</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Capture samples to update face data (tip: include with/without glasses)
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none font-light"
          >
            &times;
          </button>
        </div>
        <div className="p-5 space-y-4">
          <CameraView
            videoRef={videoRef}
            canvasRef={canvasRef}
            ready={ready}
            error={error}
            className="aspect-video"
          />

          {captures.length > 0 && (
            <div className="space-y-1">
              <div className="flex gap-1 flex-wrap">
                {Array.from({ length: Math.max(captures.length, CAPTURE_COUNT) }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-2 flex-1 min-w-[8px] rounded-full ${
                      i < captures.length ? 'bg-brand' : 'bg-gray-200'
                    }`}
                  />
                ))}
              </div>
              <p className="text-xs text-gray-400 text-right">{captures.length} samples</p>
            </div>
          )}

          {status && (
            <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              {status}
            </p>
          )}

          {!modelsReady && (
            <p className="text-xs text-gray-400 text-center">Loading face recognition models…</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleCapture}
              disabled={capturing || !ready || !modelsReady}
              className="flex-1 bg-brand hover:bg-brand-dark text-white font-semibold py-2 rounded-lg text-sm transition-colors disabled:opacity-60"
            >
              {capturing ? 'Capturing…' : captures.length === 0 ? 'Capture Samples' : '+ More Samples'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || captures.length < 3}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded-lg text-sm transition-colors disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Branches Tab (admin only) ─────────────────────────────────────────────────

function BranchesTab() {
  const [branches, setBranches] = useState([]);
  const [form, setForm] = useState({ code: '', name: '', pin: '' });
  const [editingCode, setEditingCode] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    const all = await getAllBranches();
    setBranches(all.filter((b) => b.code !== 'SUPER-ADMIN'));
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setForm({ code: '', name: '', pin: '' });
    setEditingCode(null);
    setShowForm(true);
    setStatus('');
  }

  function openEdit(b) {
    setForm({ code: b.code, name: b.name, pin: b.pin ?? '' });
    setEditingCode(b.code);
    setShowForm(true);
    setStatus('');
  }

  async function handleSave(e) {
    e.preventDefault();
    const code = form.code.trim().toUpperCase();
    if (!code || !form.name.trim()) { setStatus('Code and name are required.'); return; }
    if (code === 'SUPER-ADMIN') { setStatus('That code is reserved.'); return; }
    try {
      await saveBranch({ code, name: form.name.trim(), pin: form.pin.trim() });
      setStatus(editingCode ? 'Branch updated.' : 'Branch created.');
      setShowForm(false);
      load();
    } catch (err) {
      setStatus('Error: ' + err.message);
    }
  }

  async function handleDelete(code) {
    if (!confirm(`Delete branch "${code}"? Existing logs will be retained.`)) return;
    await deleteBranch(code);
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-700">Branches</h2>
        <button
          onClick={openCreate}
          className="bg-brand hover:bg-brand-dark text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors"
        >
          + New Branch
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="bg-brand-light border border-brand-border rounded-xl p-4 mb-4 space-y-3 max-w-md">
          <h3 className="font-medium text-gray-700">{editingCode ? 'Edit Branch' : 'New Branch'}</h3>
          <input
            type="text"
            placeholder="Branch Code (e.g. EAST-004)"
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            disabled={!!editingCode}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100 uppercase focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <input
            type="text"
            placeholder="Branch Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <input
            type="password"
            placeholder="PIN"
            value={form.pin}
            onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
          {status && <p className="text-sm text-red-600">{status}</p>}
          <div className="flex gap-2">
            <button type="submit" className="bg-brand hover:bg-brand-dark text-white text-sm font-semibold px-4 py-2 rounded-lg">
              Save
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-semibold px-4 py-2 rounded-lg">
              Cancel
            </button>
          </div>
        </form>
      )}

      {branches.length === 0 ? (
        <EmptyState icon="🏢" message="No branches yet. Create one above." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">PIN</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {branches.map((b) => (
                <tr key={b.code} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-gray-600">{b.code}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{b.name}</td>
                  <td className="px-4 py-3 text-gray-400 tracking-widest">
                    {'•'.repeat(b.pin?.length ?? 0)}
                  </td>
                  <td className="px-4 py-3 flex gap-3">
                    <button onClick={() => openEdit(b)}
                      className="text-brand hover:text-brand-dark text-xs font-medium">
                      Edit
                    </button>
                    <button onClick={() => handleDelete(b.code)}
                      className="text-red-500 hover:text-red-700 text-xs font-medium">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Employees Tab ─────────────────────────────────────────────────────────────

function EmployeesTab({ branch }) {
  const isSuperAdmin = branch.isAdmin;
  const [employees, setEmployees] = useState([]);
  const [allBranches, setAllBranches] = useState([]);
  const [filterBranch, setFilterBranch] = useState('ALL');
  const [faceUpdateEmp, setFaceUpdateEmp] = useState(null);

  const load = useCallback(async () => {
    if (isSuperAdmin) {
      const [all, branches] = await Promise.all([getAllEmployees(), getAllBranches()]);
      setAllBranches(branches.filter((b) => b.code !== 'SUPER-ADMIN'));
      setEmployees(all);
    } else {
      const list = await getEmployeesByBranch(branch.code);
      setEmployees(list);
    }
  }, [branch, isSuperAdmin]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id) {
    if (!confirm('Delete this employee and all their face data?')) return;
    await deleteEmployee(id);
    load();
  }

  const visible = isSuperAdmin && filterBranch !== 'ALL'
    ? employees.filter((e) => e.homeBranch === filterBranch)
    : employees;

  return (
    <div>
      {faceUpdateEmp && (
        <FaceUpdateModal
          employee={faceUpdateEmp}
          onClose={() => setFaceUpdateEmp(null)}
          onSaved={load}
        />
      )}

      <div className="flex items-center justify-between mb-4 gap-4">
        <h2 className="font-semibold text-gray-700">
          Employees {isSuperAdmin ? '(All Branches)' : `— ${branch.name}`}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{visible.length} total</span>
          {isSuperAdmin && (
            <select
              value={filterBranch}
              onChange={(e) => setFilterBranch(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none"
            >
              <option value="ALL">All Branches</option>
              {allBranches.map((b) => (
                <option key={b.code} value={b.code}>{b.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState icon="👤" message="No employees. Use the Register page to add employees." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">UID</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Position</th>
                <th className="px-4 py-3 text-left">Samples</th>
                <th className="px-4 py-3 text-left">Registered</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visible.map((emp) => (
                <tr key={emp.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-brand font-semibold bg-brand-light px-2 py-0.5 rounded">
                      {emp.uid || `#${emp.id}`}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-brand-light flex items-center justify-center text-brand font-bold text-xs shrink-0">
                        {emp.name[0].toUpperCase()}
                      </div>
                      <span className="font-medium text-gray-800">{emp.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{emp.position || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{emp.descriptors?.length ?? 0}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {emp.createdAt ? new Date(emp.createdAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 flex gap-3">
                    <button
                      onClick={() => setFaceUpdateEmp(emp)}
                      className="text-brand hover:text-brand-dark text-xs font-medium"
                    >
                      Update Face
                    </button>
                    <button onClick={() => handleDelete(emp.id)}
                      className="text-red-500 hover:text-red-700 text-xs font-medium">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Time Logs Tab ─────────────────────────────────────────────────────────────

function TimeLogsTab({ branch }) {
  const isSuperAdmin = branch.isAdmin;
  const [logs, setLogs] = useState([]);
  const [date, setDate] = useState(todayDateString());
  const [selectedBranch, setSelectedBranch] = useState(isSuperAdmin ? 'ALL' : branch.code);
  const [allBranches, setAllBranches] = useState([]);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteText, setNoteText] = useState('');

  useEffect(() => {
    if (isSuperAdmin) {
      getAllBranches().then((bs) =>
        setAllBranches(bs.filter((b) => b.code !== 'SUPER-ADMIN'))
      );
    }
  }, [isSuperAdmin]);

  const load = useCallback(async () => {
    const branchFilter = isSuperAdmin
      ? (selectedBranch === 'ALL' ? undefined : selectedBranch)
      : branch.code;
    const raw = await getLogsByDate(date, branchFilter);
    const enriched = await Promise.all(
      raw.map(async (l) => {
        const emp = await getEmployee(l.employeeId);
        return { ...l, employeeName: emp?.name ?? `#${l.employeeId}`, uid: emp?.uid ?? '' };
      })
    );
    enriched.sort((a, b) => new Date(b.timeIn) - new Date(a.timeIn));
    setLogs(enriched);
  }, [date, branch, selectedBranch, isSuperAdmin]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id) {
    if (!confirm('Delete this log entry?')) return;
    await deleteLog(id);
    load();
  }

  async function saveNote(log) {
    await saveLog({ ...log, note: noteText });
    setEditingNoteId(null);
    setLogs((prev) => prev.map((l) => l.id === log.id ? { ...l, note: noteText } : l));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h2 className="font-semibold text-gray-700">Time Logs</h2>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none"
        />
        {isSuperAdmin && (
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none"
          >
            <option value="ALL">All Branches</option>
            {allBranches.map((b) => (
              <option key={b.code} value={b.code}>{b.name}</option>
            ))}
          </select>
        )}
        <button onClick={load} className="text-sm text-brand hover:text-brand-dark font-medium">
          Refresh
        </button>
      </div>

      {logs.length === 0 ? (
        <EmptyState icon="🗓️" message="No logs for this date." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-3 py-3 text-left">UID</th>
                <th className="px-3 py-3 text-left">Employee</th>
                <th className="px-3 py-3 text-left">Date</th>
                <th className="px-3 py-3 text-left">Time In</th>
                <th className="px-3 py-3 text-left">Time Out</th>
                <th className="px-3 py-3 text-left">Branch In</th>
                <th className="px-3 py-3 text-left">Branch Out</th>
                <th className="px-3 py-3 text-left">Duration</th>
                <th className="px-3 py-3 text-left">Note</th>
                <th className="px-3 py-3 text-left">Status</th>
                <th className="px-3 py-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-3 py-3">
                    <span className="text-xs font-mono text-brand font-semibold">
                      {log.uid || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-medium text-gray-800">{log.employeeName}</td>
                  <td className="px-3 py-3 text-gray-600">{log.date}</td>
                  <td className="px-3 py-3 text-gray-600">{formatTime(log.timeIn)}</td>
                  <td className="px-3 py-3 text-gray-600">{formatTime(log.timeOut)}</td>
                  <td className="px-3 py-3 text-xs font-mono text-gray-500">
                    {log.branchIn ?? log.branchCode ?? '—'}
                  </td>
                  <td className="px-3 py-3 text-xs font-mono text-gray-500">
                    {log.branchOut ?? '—'}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {log.timeOut
                      ? <span className="text-gray-500">{calcDuration(log.timeIn, log.timeOut) || '—'}</span>
                      : <ElapsedTime timeIn={log.timeIn} />
                    }
                  </td>
                  <td className="px-3 py-3">
                    {editingNoteId === log.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          className="border border-gray-300 rounded px-2 py-1 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-brand"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === 'Enter') saveNote(log); if (e.key === 'Escape') setEditingNoteId(null); }}
                        />
                        <button onClick={() => saveNote(log)} className="text-xs text-brand hover:text-brand-dark font-medium">✓</button>
                        <button onClick={() => setEditingNoteId(null)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 group">
                        <span className="text-xs text-gray-500 max-w-[80px] truncate" title={log.note || ''}>
                          {log.note || <span className="text-gray-300">—</span>}
                        </span>
                        <button
                          onClick={() => { setEditingNoteId(log.id); setNoteText(log.note || ''); }}
                          className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-brand transition-opacity shrink-0"
                          title="Edit note"
                        >
                          ✎
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {log.timeOut ? (
                      <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full">Complete</span>
                    ) : (
                      <span className="text-xs text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full">Present</span>
                    )}
                    {log.manual && (
                      <span className="ml-1 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">Manual</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <button onClick={() => handleDelete(log.id)}
                      className="text-red-500 hover:text-red-700 text-xs font-medium">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Manual Entry Tab ──────────────────────────────────────────────────────────

function ManualEntryTab({ branch }) {
  const isSuperAdmin = branch.isAdmin;

  // ── New log entry form ──
  const [employees, setEmployees] = useState([]);
  const [allBranches, setAllBranches] = useState([]);
  const [targetBranch, setTargetBranch] = useState(isSuperAdmin ? '' : branch.code);
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(todayDateString());
  const [timeIn, setTimeIn] = useState('08:00');
  const [timeOut, setTimeOut] = useState('17:00');
  const [includeOut, setIncludeOut] = useState(true);
  const [note, setNote] = useState('Manual entry');
  const [status, setStatus] = useState('');

  // ── Manual time-out section ──
  const [openLogs, setOpenLogs] = useState([]);
  const [timeoutLogId, setTimeoutLogId] = useState('');
  const [timeoutTime, setTimeoutTime] = useState('');
  const [timeoutStatus, setTimeoutStatus] = useState('');
  const [timeoutNote, setTimeoutNote] = useState('Manual time-out by admin');

  useEffect(() => {
    if (isSuperAdmin) {
      getAllEmployees().then(setEmployees);
      getAllBranches().then((bs) =>
        setAllBranches(bs.filter((b) => b.code !== 'SUPER-ADMIN'))
      );
    } else {
      getEmployeesByBranch(branch.code).then(setEmployees);
    }
    loadOpenLogs();
  }, [branch, isSuperAdmin]);

  async function loadOpenLogs() {
    const today = todayDateString();
    const branchFilter = isSuperAdmin ? undefined : branch.code;
    const raw = await getLogsByDate(today, branchFilter);
    const open = raw.filter((l) => !l.timeOut);
    const enriched = await Promise.all(
      open.map(async (l) => {
        const emp = await getEmployee(l.employeeId);
        return { ...l, employeeName: emp?.name ?? `#${l.employeeId}`, uid: emp?.uid ?? '' };
      })
    );
    setOpenLogs(enriched);
    // Default timeout time to now
    const now = new Date();
    setTimeoutTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const logBranch = isSuperAdmin ? targetBranch : branch.code;
    if (!employeeId) { setStatus('Select an employee.'); return; }
    if (isSuperAdmin && !logBranch) { setStatus('Select a target branch.'); return; }
    try {
      const timeInISO = new Date(`${date}T${timeIn}:00`).toISOString();
      const timeOutISO = includeOut ? new Date(`${date}T${timeOut}:00`).toISOString() : null;
      await addLog({
        employeeId: Number(employeeId),
        branchCode: logBranch,
        branchIn: logBranch,
        branchOut: includeOut ? logBranch : null,
        date,
        timeIn: timeInISO,
        timeOut: timeOutISO,
        synced: false,
        manual: true,
        note: note.trim(),
      });
      setStatus('Log entry added successfully.');
      setEmployeeId('');
      setNote('Manual entry');
      await loadOpenLogs();
    } catch (err) {
      setStatus('Error: ' + err.message);
    }
  }

  async function handleManualTimeout(e) {
    e.preventDefault();
    if (!timeoutLogId) { setTimeoutStatus('Select an employee to time out.'); return; }
    if (!timeoutTime) { setTimeoutStatus('Enter a time-out time.'); return; }
    const log = openLogs.find((l) => String(l.id) === timeoutLogId);
    if (!log) { setTimeoutStatus('Log not found.'); return; }
    try {
      const timeOutISO = new Date(`${log.date}T${timeoutTime}:00`).toISOString();
      if (new Date(timeOutISO) <= new Date(log.timeIn)) {
        setTimeoutStatus('Time-out must be after time-in.');
        return;
      }
      await saveLog({
        ...log,
        timeOut: timeOutISO,
        branchOut: log.branchIn ?? log.branchCode,
        synced: false,
        note: timeoutNote.trim(),
      });
      setTimeoutStatus(`Timed out ${log.employeeName} at ${timeoutTime}.`);
      setTimeoutLogId('');
      await loadOpenLogs();
    } catch (err) {
      setTimeoutStatus('Error: ' + err.message);
    }
  }

  return (
    <div className="space-y-8">
      {/* ── New log entry ── */}
      <div className="max-w-md">
        <h2 className="font-semibold text-gray-700 mb-4">Add Log Entry</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          {isSuperAdmin && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target Branch</label>
              <select
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="">— Select Branch —</option>
                {allBranches.map((b) => (
                  <option key={b.code} value={b.code}>{b.name} ({b.code})</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">— Select Employee —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}{e.uid ? ` (${e.uid})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Time In</label>
            <input type="time" value={timeIn} onChange={(e) => setTimeIn(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="includeOut" checked={includeOut}
              onChange={(e) => setIncludeOut(e.target.checked)} className="rounded" />
            <label htmlFor="includeOut" className="text-sm font-medium text-gray-700">Include Time Out</label>
          </div>

          {includeOut && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Time Out</label>
              <input type="time" value={timeOut} onChange={(e) => setTimeOut(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reason for manual entry…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>

          {status && (
            <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{status}</p>
          )}

          <button type="submit"
            className="w-full bg-brand hover:bg-brand-dark text-white font-semibold py-2 rounded-lg text-sm transition-colors">
            Add Log Entry
          </button>
        </form>
      </div>

      {/* ── Manual time-out ── */}
      <div className="max-w-md border-t border-gray-100 pt-6">
        <h2 className="font-semibold text-gray-700 mb-1">Manual Time-Out</h2>
        <p className="text-xs text-gray-400 mb-4">
          Time out an employee who forgot to clock out today.
        </p>

        {openLogs.length === 0 ? (
          <p className="text-sm text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-3 py-3">
            No employees currently clocked in today.
          </p>
        ) : (
          <form onSubmit={handleManualTimeout} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currently Clocked In</label>
              <select
                value={timeoutLogId}
                onChange={(e) => setTimeoutLogId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="">— Select Employee —</option>
                {openLogs.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.employeeName}{l.uid ? ` (${l.uid})` : ''} — in at {formatTime(l.timeIn)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Time Out</label>
              <input
                type="time"
                value={timeoutTime}
                onChange={(e) => setTimeoutTime(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
              <input
                type="text"
                value={timeoutNote}
                onChange={(e) => setTimeoutNote(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>

            {timeoutStatus && (
              <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{timeoutStatus}</p>
            )}

            <button type="submit"
              className="w-full bg-gray-700 hover:bg-gray-800 text-white font-semibold py-2 rounded-lg text-sm transition-colors">
              Set Time-Out
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Settings Tab ──────────────────────────────────────────────────────────────

function SettingsTab({ branch }) {
  const isSuperAdmin = branch.isAdmin;
  const [url, setUrl] = useState(getAppsScriptUrl());
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState('');

  function handleSaveUrl() {
    saveAppsScriptUrl(url.trim());
    setStatus('Apps Script URL saved.');
  }

  async function handleBulkSync() {
    setSyncing(true);
    setStatus('');
    try {
      const logs = await getAllLogs();
      const unsynced = isSuperAdmin
        ? logs.filter((l) => !l.synced)
        : logs.filter((l) => !l.synced && l.branchCode === branch.code);

      if (unsynced.length === 0) { setStatus('Nothing to sync.'); return; }

      const enriched = await Promise.all(
        unsynced.map(async (l) => {
          const emp = await getEmployee(l.employeeId);
          return {
            uid: emp?.uid ?? '',
            employeeName: emp?.name ?? `#${l.employeeId}`,
            date: l.date,
            timeIn: l.timeIn ? new Date(l.timeIn).toLocaleTimeString() : '',
            timeOut: l.timeOut ? new Date(l.timeOut).toLocaleTimeString() : '',
            branchIn: l.branchIn ?? l.branchCode ?? '',
            branchOut: l.branchOut ?? '',
            duration: calcDuration(l.timeIn, l.timeOut),
          };
        })
      );
      await bulkPushLogsToSheets(enriched);
      setStatus(`Synced ${unsynced.length} record(s) to Google Sheets.`);
    } catch (err) {
      setStatus('Sync failed: ' + err.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="font-semibold text-gray-700 mb-3">Google Sheets Integration</h2>
        <p className="text-xs text-gray-500 mb-3">
          Deploy the Apps Script Web App (see <code className="bg-gray-100 px-1 rounded">apps-script/Code.gs</code>) and paste the URL below.
        </p>
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/…/exec"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <button onClick={handleSaveUrl}
            className="bg-brand hover:bg-brand-dark text-white text-sm font-semibold px-3 py-2 rounded-lg">
            Save
          </button>
        </div>
      </div>

      <div>
        <h2 className="font-semibold text-gray-700 mb-2">
          Sync Unsynced Logs {isSuperAdmin ? '(All Branches)' : ''}
        </h2>
        <button
          onClick={handleBulkSync}
          disabled={syncing}
          className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 transition-colors"
        >
          {syncing ? 'Syncing…' : 'Sync Now'}
        </button>
      </div>

      {status && (
        <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{status}</p>
      )}
    </div>
  );
}

// ── Main Admin Page ───────────────────────────────────────────────────────────

export default function AdminPage() {
  const { branch } = useBranch();
  const isSuperAdmin = branch.isAdmin;

  const TABS = isSuperAdmin
    ? ['Branches', 'Employees', 'Time Logs', 'Manual Entry', 'Settings']
    : ['Employees', 'Time Logs', 'Manual Entry', 'Settings'];

  const [tab, setTab] = useState(TABS[0]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Admin</h1>
        {isSuperAdmin && (
          <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
            All Branches
          </span>
        )}
        {!isSuperAdmin && (
          <span className="text-xs font-semibold bg-brand-light text-brand px-2 py-0.5 rounded-full">
            {branch.name}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              tab === t
                ? 'bg-white text-brand shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6">
        {tab === 'Branches' && isSuperAdmin && <BranchesTab />}
        {tab === 'Employees' && <EmployeesTab branch={branch} />}
        {tab === 'Time Logs' && <TimeLogsTab branch={branch} />}
        {tab === 'Manual Entry' && <ManualEntryTab branch={branch} />}
        {tab === 'Settings' && <SettingsTab branch={branch} />}
      </div>
    </div>
  );
}
