import { useState, useEffect, useCallback, useMemo } from 'react';
import { useBranch } from '../context/BranchContext';
import {
  getLogsByDate,
  getEmployee,
  getAllBranches,
  getAllEmployees,
  todayDateString,
} from '../lib/db';

// ── Shared helpers ────────────────────────────────────────────────────────────

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function duration(timeIn, timeOut) {
  if (!timeIn || !timeOut) return '—';
  const ms = new Date(timeOut) - new Date(timeIn);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

function StatusBadge({ log }) {
  if (log.timeOut) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
        Timed Out
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
      <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block animate-pulse" />
      Present
    </span>
  );
}

function StatCard({ label, value, color }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-100',
    green: 'bg-green-50 text-green-700 border-green-100',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  );
}

// ── Branch-scoped dashboard (existing behaviour) ──────────────────────────────

function BranchDashboard({ branch }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const today = todayDateString();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const logs = await getLogsByDate(today, branch.code);
      const enriched = await Promise.all(
        logs.map(async (log) => {
          const emp = await getEmployee(log.employeeId);
          return { ...log, employeeName: emp?.name ?? `#${log.employeeId}` };
        })
      );
      enriched.sort((a, b) => new Date(b.timeIn) - new Date(a.timeIn));
      setRows(enriched);
    } finally {
      setLoading(false);
    }
  }, [branch, today]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const present = rows.filter((r) => !r.timeOut).length;
  const out = rows.filter((r) => r.timeOut).length;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
          <p className="text-sm text-gray-500">
            {branch.name} &bull; {today}
          </p>
        </div>
        <button onClick={load} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Today" value={rows.length} color="blue" />
        <StatCard label="Present" value={present} color="yellow" />
        <StatCard label="Timed Out" value={out} color="green" />
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-700">Today's Attendance</h2>
          <span className="text-xs text-gray-400">Auto-refreshes every 30s</span>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-4xl mb-2">📋</div>
            <p className="text-sm text-gray-400">No attendance records yet today.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Employee</th>
                  <th className="px-4 py-3 text-left">Time In</th>
                  <th className="px-4 py-3 text-left">Time Out</th>
                  <th className="px-4 py-3 text-left">Duration</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-800">{row.employeeName}</td>
                    <td className="px-4 py-3 text-gray-600">{formatTime(row.timeIn)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatTime(row.timeOut)}</td>
                    <td className="px-4 py-3 text-gray-500">{duration(row.timeIn, row.timeOut)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge log={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Per-branch card (admin view) ──────────────────────────────────────────────

function BranchCard({ branch, logs }) {
  const present = logs.filter((l) => !l.timeOut).length;
  const timedOut = logs.filter((l) => l.timeOut).length;
  const latest = [...logs]
    .sort((a, b) => new Date(b.timeIn) - new Date(a.timeIn))
    .slice(0, 5);

  return (
    <div className="bg-white rounded-xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800">{branch.name}</h3>
        <span className="text-xs text-gray-400 font-mono bg-gray-100 px-2 py-0.5 rounded">
          {branch.code}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-4 text-center">
        <div className="bg-blue-50 rounded-lg p-2">
          <p className="text-xs text-blue-600 font-medium">Total</p>
          <p className="text-xl font-bold text-blue-700">{logs.length}</p>
        </div>
        <div className="bg-yellow-50 rounded-lg p-2">
          <p className="text-xs text-yellow-600 font-medium">Present</p>
          <p className="text-xl font-bold text-yellow-700">{present}</p>
        </div>
        <div className="bg-green-50 rounded-lg p-2">
          <p className="text-xs text-green-600 font-medium">Out</p>
          <p className="text-xl font-bold text-green-700">{timedOut}</p>
        </div>
      </div>
      {latest.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-2">No activity today</p>
      ) : (
        <ul className="divide-y divide-gray-50 text-xs">
          {latest.map((log) => (
            <li key={log.id} className="flex items-center justify-between py-1.5 text-gray-600">
              <span className="font-medium text-gray-800 truncate">{log.employeeName}</span>
              <StatusBadge log={log} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Super admin dashboard ─────────────────────────────────────────────────────

function SuperAdminDashboard() {
  const [allBranches, setAllBranches] = useState([]);
  const [allLogs, setAllLogs] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [filterBranch, setFilterBranch] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const today = todayDateString();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [branches, logs, emps] = await Promise.all([
        getAllBranches(),
        getLogsByDate(today),
        getAllEmployees(),
      ]);
      setAllBranches(branches.filter((b) => b.code !== 'SUPER-ADMIN'));
      setAllLogs(logs);
      setEmployees(emps);
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const empMap = useMemo(
    () => Object.fromEntries(employees.map((e) => [e.id, e])),
    [employees]
  );

  const enrichedLogs = useMemo(
    () =>
      allLogs.map((log) => ({
        ...log,
        employeeName: empMap[log.employeeId]?.name ?? `#${log.employeeId}`,
      })),
    [allLogs, empMap]
  );

  const visibleLogs =
    filterBranch === 'ALL'
      ? enrichedLogs
      : enrichedLogs.filter((l) => l.branchCode === filterBranch);

  const present = visibleLogs.filter((l) => !l.timeOut).length;
  const timedOut = visibleLogs.filter((l) => l.timeOut).length;

  const branchesToShow =
    filterBranch === 'ALL'
      ? allBranches
      : allBranches.filter((b) => b.code === filterBranch);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Global Dashboard</h1>
          <p className="text-sm text-gray-500">{today} &bull; All Branches</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={filterBranch}
            onChange={(e) => setFilterBranch(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Branches</option>
            {allBranches.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </select>
          <button
            onClick={load}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Global stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard label="Total Today" value={visibleLogs.length} color="blue" />
        <StatCard label="Present" value={present} color="yellow" />
        <StatCard label="Timed Out" value={timedOut} color="green" />
      </div>

      {/* Per-branch cards */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
      ) : branchesToShow.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-2">🏢</div>
          <p className="text-sm text-gray-400">No branches configured yet. Add one in Admin → Branches.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {branchesToShow.map((b) => {
            const bLogs = enrichedLogs.filter((l) => l.branchCode === b.code);
            return <BranchCard key={b.code} branch={b} logs={bLogs} />;
          })}
        </div>
      )}
    </div>
  );
}

// ── Entry point ───────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { branch } = useBranch();
  if (branch.isAdmin) return <SuperAdminDashboard />;
  return <BranchDashboard branch={branch} />;
}
