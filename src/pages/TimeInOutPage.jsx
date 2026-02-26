import { useState, useRef, useEffect, useCallback } from 'react';
import { useBranch } from '../context/BranchContext';
import { useCamera } from '../hooks/useCamera';
import CameraView from '../components/CameraView';
import {
  loadModels,
  detectSingleFaceDescriptor,
  buildMatcher,
  drawDetections,
} from '../lib/faceApi';
import {
  getAllEmployees,
  getTodayLogForEmployee,
  addLog,
  saveLog,
  todayDateString,
} from '../lib/db';
import { pushLogToSheets, calcDuration } from '../lib/sheets';

const SCAN_INTERVAL_MS = 800;

export default function TimeInOutPage() {
  const { branch } = useBranch();
  const { videoRef, ready, error } = useCamera();
  const canvasRef = useRef(null);

  const [modelsReady, setModelsReady] = useState(false);
  const [matcher, setMatcher] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState('');

  // Confirmation state
  const [pending, setPending] = useState(null);
  // pending: { employee, proposedAction: 'Time In'|'Time Out'|'Already Complete', existingLog }

  // Result state
  const [lastResult, setLastResult] = useState(null);
  // lastResult: { name, uid, action, time }

  const scanningRef = useRef(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    async function init() {
      await loadModels();
      setModelsReady(true);
      await refreshEmployees();
    }
    init();
  }, []);

  async function refreshEmployees() {
    const list = await getAllEmployees();
    setEmployees(list);
    if (list.length > 0) {
      const labeled = list
        .filter((e) => e.descriptors?.length > 0)
        .map((e) => ({ label: String(e.id), descriptors: e.descriptors }));
      const m = buildMatcher(labeled, 0.5);
      setMatcher(m);
    }
  }

  // ── Scan loop ──────────────────────────────────────────────────────────────

  const runScan = useCallback(async () => {
    if (!videoRef.current || !modelsReady || !matcher) return;
    try {
      const detection = await detectSingleFaceDescriptor(videoRef.current);
      if (!detection) {
        setMessage('Looking for a face…');
        return;
      }
      if (canvasRef.current) {
        drawDetections(canvasRef.current, videoRef.current, [detection]);
      }
      const match = matcher.findBestMatch(detection.descriptor);
      if (match.label === 'unknown') {
        setMessage('Face not recognised. Please register first.');
        return;
      }
      // Stop scan and show confirmation
      stopScan();
      const emp = employees.find((e) => String(e.id) === match.label);
      if (!emp) return;
      const existingLog = await getTodayLogForEmployee(emp.id);
      const proposedAction = !existingLog
        ? 'Time In'
        : !existingLog.timeOut
        ? 'Time Out'
        : 'Already Complete';
      setPending({ employee: emp, proposedAction, existingLog });
      setMessage('');
    } catch (err) {
      setMessage('Scan error: ' + err.message);
    }
  }, [videoRef, modelsReady, matcher, employees]);

  function startScan() {
    if (scanningRef.current) return;
    if (!matcher) {
      setMessage('No registered employees. Please register employees first.');
      return;
    }
    setPending(null);
    setLastResult(null);
    setMessage('Scanning…');
    scanningRef.current = true;
    setScanning(true);
    intervalRef.current = setInterval(runScan, SCAN_INTERVAL_MS);
  }

  function stopScan() {
    clearInterval(intervalRef.current);
    scanningRef.current = false;
    setScanning(false);
  }

  useEffect(() => () => clearInterval(intervalRef.current), []);

  // ── Confirmation handlers ──────────────────────────────────────────────────

  async function handleConfirm() {
    if (!pending) return;
    const { employee: emp, proposedAction, existingLog } = pending;
    const today = todayDateString();
    const now = new Date().toISOString();

    if (proposedAction === 'Time In') {
      await addLog({
        employeeId: emp.id,
        branchCode: branch.code,
        branchIn: branch.code,
        branchOut: null,
        date: today,
        timeIn: now,
        timeOut: null,
        synced: false,
      });
      try {
        await pushLogToSheets({
          uid: emp.uid || `#${emp.id}`,
          employeeName: emp.name,
          date: today,
          timeIn: new Date(now).toLocaleTimeString(),
          timeOut: '',
          branchIn: branch.code,
          branchOut: '',
          duration: '',
        });
      } catch {/* offline */}
    } else if (proposedAction === 'Time Out') {
      const updatedLog = { ...existingLog, timeOut: now, branchOut: branch.code, synced: false };
      await saveLog(updatedLog);
      try {
        await pushLogToSheets({
          uid: emp.uid || `#${emp.id}`,
          employeeName: emp.name,
          date: today,
          timeIn: new Date(updatedLog.timeIn).toLocaleTimeString(),
          timeOut: new Date(now).toLocaleTimeString(),
          branchIn: updatedLog.branchIn ?? updatedLog.branchCode,
          branchOut: branch.code,
          duration: calcDuration(updatedLog.timeIn, now),
        });
      } catch {/* offline */}
    }

    setLastResult({
      name: emp.name,
      uid: emp.uid || `#${emp.id}`,
      action: proposedAction,
      time: new Date().toLocaleTimeString(),
    });
    setPending(null);
  }

  function handleCancelConfirm() {
    setPending(null);
    startScan();
  }

  const canScan = modelsReady && ready && !!matcher;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-2">Time In / Out</h1>
      <p className="text-sm text-gray-500 mb-6">
        {branch.name} &bull; {employees.length} employee(s) registered
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Camera column */}
        <div className="space-y-4">
          <CameraView
            videoRef={videoRef}
            canvasRef={canvasRef}
            ready={ready}
            error={error}
            className="aspect-video"
          />

          {message && (
            <p className="text-sm text-center text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              {message}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={startScan}
              disabled={scanning || !canScan || !!pending}
              className="flex-1 bg-brand hover:bg-brand-dark text-white font-semibold py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60"
            >
              {scanning ? 'Scanning…' : 'Start Scan'}
            </button>
            <button
              onClick={stopScan}
              disabled={!scanning}
              className="flex-1 bg-gray-400 hover:bg-gray-500 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60"
            >
              Stop
            </button>
          </div>

          {!modelsReady && (
            <p className="text-xs text-gray-400 text-center">Loading face recognition models…</p>
          )}
          {modelsReady && !matcher && (
            <p className="text-xs text-center bg-yellow-50 border border-yellow-200 text-yellow-700 rounded-lg px-3 py-2">
              No employees registered yet. Go to Register first.
            </p>
          )}
        </div>

        {/* Right column: confirmation / result / roster */}
        <div className="flex flex-col gap-4">

          {/* ── Confirmation card ── */}
          {pending && (
            <div className="rounded-xl p-6 bg-white border-2 border-brand shadow-md text-center">
              <p className="text-xs font-semibold text-brand uppercase tracking-wide mb-3">
                Confirm Identity
              </p>
              <div className="w-16 h-16 rounded-full bg-brand-light flex items-center justify-center text-brand font-bold text-2xl mx-auto mb-3">
                {pending.employee.name[0].toUpperCase()}
              </div>
              <p className="text-xl font-bold text-gray-800">{pending.employee.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{pending.employee.uid}</p>

              {pending.proposedAction === 'Already Complete' ? (
                <div className="mt-3 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2">
                  <p className="text-sm text-gray-500">Already timed in and out today.</p>
                </div>
              ) : (
                <div className={`mt-3 inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1 rounded-full ${
                  pending.proposedAction === 'Time In'
                    ? 'bg-brand-light text-brand'
                    : 'bg-green-100 text-green-700'
                }`}>
                  {pending.proposedAction === 'Time In' ? '→ Time In' : '← Time Out'}
                </div>
              )}

              <div className="flex gap-2 mt-5">
                {pending.proposedAction !== 'Already Complete' && (
                  <button
                    onClick={handleConfirm}
                    className="flex-1 bg-brand hover:bg-brand-dark text-white font-semibold py-2 rounded-lg text-sm transition-colors"
                  >
                    Confirm
                  </button>
                )}
                <button
                  onClick={handleCancelConfirm}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2 rounded-lg text-sm transition-colors"
                >
                  Not me
                </button>
              </div>
            </div>
          )}

          {/* ── Result card ── */}
          {!pending && lastResult && (
            <div className={`rounded-xl p-6 text-center shadow-sm ${
              lastResult.action === 'Time In'
                ? 'bg-brand-light border border-brand-border'
                : lastResult.action === 'Time Out'
                ? 'bg-green-50 border border-green-200'
                : 'bg-gray-50 border border-gray-200'
            }`}>
              <div className="text-4xl mb-2">
                {lastResult.action === 'Time In' ? '✅' : lastResult.action === 'Time Out' ? '👋' : 'ℹ️'}
              </div>
              <p className="text-xl font-bold text-gray-800">{lastResult.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{lastResult.uid}</p>
              <p className={`text-lg font-semibold mt-2 ${
                lastResult.action === 'Time In'
                  ? 'text-brand'
                  : lastResult.action === 'Time Out'
                  ? 'text-green-700'
                  : 'text-gray-500'
              }`}>
                {lastResult.action}
              </p>
              <p className="text-sm text-gray-500 mt-1">{lastResult.time}</p>
              <button
                onClick={startScan}
                className="mt-4 bg-brand hover:bg-brand-dark text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                Scan Next
              </button>
            </div>
          )}

          {/* ── Idle placeholder ── */}
          {!pending && !lastResult && (
            <div className="rounded-xl p-6 bg-white border border-gray-100 shadow-sm text-center text-gray-400 text-sm">
              <div className="text-5xl mb-3">👤</div>
              <p>Scan result will appear here.</p>
            </div>
          )}

          {/* ── Employee roster ── */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Registered Employees</h2>
            </div>
            {employees.length === 0 ? (
              <p className="p-3 text-xs text-gray-400 text-center">None</p>
            ) : (
              <ul className="divide-y divide-gray-50 max-h-60 overflow-y-auto">
                {employees.map((e) => (
                  <li key={e.id} className="px-4 py-2 flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-brand-light flex items-center justify-center text-brand font-bold text-xs shrink-0">
                      {e.name[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <span className="text-sm text-gray-700 font-medium truncate block">{e.name}</span>
                      {e.uid && <span className="text-xs text-gray-400">{e.uid}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
