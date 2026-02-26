import { useState, useEffect, useCallback } from 'react';
import { useBranch } from '../context/BranchContext';
import {
  getAllEmployees,
  getEmployeesByBranch,
  deleteEmployee,
  getAllLogs,
  getLogsByDate,
  addLog,
  deleteLog,
  todayDateString,
  getEmployee,
  getAllBranches,
  saveBranch,
  deleteBranch,
} from '../lib/db';
import { getAppsScriptUrl, saveAppsScriptUrl, bulkPushLogsToSheets } from '../lib/sheets';

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors"
        >
          + New Branch
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 space-y-3 max-w-md">
          <h3 className="font-medium text-gray-700">{editingCode ? 'Edit Branch' : 'New Branch'}</h3>
          <input
            type="text"
            placeholder="Branch Code (e.g. EAST-004)"
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            disabled={!!editingCode}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100 uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="text"
            placeholder="Branch Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="password"
            placeholder="PIN"
            value={form.pin}
            onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {status && <p className="text-sm text-red-600">{status}</p>}
          <div className="flex gap-2">
            <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg">
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
                      className="text-blue-600 hover:text-blue-800 text-xs font-medium">
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
                <th className="px-4 py-3 text-left">ID</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Position</th>
                {isSuperAdmin && <th className="px-4 py-3 text-left">Home Branch</th>}
                <th className="px-4 py-3 text-left">Face Samples</th>
                <th className="px-4 py-3 text-left">Registered</th>
                <th className="px-4 py-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visible.map((emp) => (
                <tr key={emp.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-400 text-xs">#{emp.id}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs shrink-0">
                        {emp.name[0].toUpperCase()}
                      </div>
                      <span className="font-medium text-gray-800">{emp.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{emp.position || '—'}</td>
                  {isSuperAdmin && (
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">
                      {emp.homeBranch || '—'}
                    </td>
                  )}
                  <td className="px-4 py-3 text-gray-600">{emp.descriptors?.length ?? 0}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {emp.createdAt ? new Date(emp.createdAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
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
        return { ...l, employeeName: emp?.name ?? `#${l.employeeId}` };
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
        <button onClick={load} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
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
                <th className="px-4 py-3 text-left">Employee</th>
                {isSuperAdmin && <th className="px-4 py-3 text-left">Branch</th>}
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Time In</th>
                <th className="px-4 py-3 text-left">Time Out</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{log.employeeName}</td>
                  {isSuperAdmin && (
                    <td className="px-4 py-3 text-xs font-mono text-gray-500">{log.branchCode}</td>
                  )}
                  <td className="px-4 py-3 text-gray-600">{log.date}</td>
                  <td className="px-4 py-3 text-gray-600">{formatTime(log.timeIn)}</td>
                  <td className="px-4 py-3 text-gray-600">{formatTime(log.timeOut)}</td>
                  <td className="px-4 py-3">
                    {log.timeOut ? (
                      <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full">Complete</span>
                    ) : (
                      <span className="text-xs text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full">Present</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
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
  const [employees, setEmployees] = useState([]);
  const [allBranches, setAllBranches] = useState([]);
  const [targetBranch, setTargetBranch] = useState(isSuperAdmin ? '' : branch.code);
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(todayDateString());
  const [timeIn, setTimeIn] = useState('08:00');
  const [timeOut, setTimeOut] = useState('17:00');
  const [includeOut, setIncludeOut] = useState(true);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (isSuperAdmin) {
      getAllEmployees().then(setEmployees);
      getAllBranches().then((bs) =>
        setAllBranches(bs.filter((b) => b.code !== 'SUPER-ADMIN'))
      );
    } else {
      getEmployeesByBranch(branch.code).then(setEmployees);
    }
  }, [branch, isSuperAdmin]);

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
        date,
        timeIn: timeInISO,
        timeOut: timeOutISO,
        synced: false,
        manual: true,
      });
      setStatus('Log entry added successfully.');
      setEmployeeId('');
    } catch (err) {
      setStatus('Error: ' + err.message);
    }
  }

  return (
    <div className="max-w-md">
      <h2 className="font-semibold text-gray-700 mb-4">Manual Entry</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        {isSuperAdmin && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Target Branch</label>
            <select
              value={targetBranch}
              onChange={(e) => setTargetBranch(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— Select Employee —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Time In</label>
          <input type="time" value={timeIn} onChange={(e) => setTimeIn(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        )}

        {status && (
          <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{status}</p>
        )}

        <button type="submit"
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-lg text-sm transition-colors">
          Add Log Entry
        </button>
      </form>
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
            branch: l.branchCode,
            employeeName: emp?.name ?? `#${l.employeeId}`,
            date: l.date,
            timeIn: l.timeIn ? new Date(l.timeIn).toLocaleTimeString() : '',
            timeOut: l.timeOut ? new Date(l.timeOut).toLocaleTimeString() : '',
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
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={handleSaveUrl}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-3 py-2 rounded-lg">
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
          <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
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
                ? 'bg-white text-blue-700 shadow-sm'
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
