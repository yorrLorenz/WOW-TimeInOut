import { useState, useRef, useEffect, useCallback } from 'react';
import { useBranch } from '../context/BranchContext';
import { useCamera } from '../hooks/useCamera';
import CameraView from '../components/CameraView';
import {
  loadModels,
  detectFaceWithLandmarks,
  detectSingleFaceDescriptor,
  buildMatcher,
  drawDetections,
} from '../lib/faceApi';
import {
  getAllEmployees,
  getAllLogs,
  getTodayLogForEmployee,
  addLog,
  saveLog,
  todayDateString,
} from '../lib/db';
import {
  pushLogToSheets, updateLogInSheets, calcDuration,
  computePeriodSummary, generateMonthlySummaryToSheets,
  generatePeriodOptions, getStandardHours,
  fetchEmployeesFromSheets,
} from '../lib/sheets';
import { mergeEmployeesFromRemote } from '../lib/db';

const SCAN_INTERVAL_MS     = 100;

// ── Gate 1: continuous pixel motion ──────────────────────────────────────────
const MOTION_THRESHOLD     = 6.0;   // avg R-channel diff to count a frame as "motion"
const STILL_THRESHOLD      = 1.0;   // below this → near-zero diff → static image → RESET presence
const REQUIRED_LIVE_FRAMES = 15;    // ~1.5 s of unbroken motion at 100 ms intervals
const FACE_SAMPLE_SIZE     = 50;

// ── Gate 2: head-turn landmark geometry ──────────────────────────────────────
// When the head turns, the nose moves closer to one eye.
// Ratio = dist(noseTip → leftEye) / dist(noseTip → rightEye)
//   Straight:    ≈ 1.0
//   Turned:      < TURN_THRESHOLD  or  > 1/TURN_THRESHOLD
// Moving a flat phone photo laterally does NOT change this internal ratio,
// making this immune to the phone-tremor spoofing that defeated pixel diff.
const TURN_THRESHOLD       = 0.78;  // 22% deviation from 1.0 = ~10–15° head turn
const REQUIRED_TURN_FRAMES = 3;     // hold the turn for 3 consecutive frames (~300 ms)

// ── Helpers ───────────────────────────────────────────────────────────────────

function captureFacePixels(videoEl, box, canvas) {
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    videoEl,
    box.x, box.y, box.width, box.height,
    0, 0, FACE_SAMPLE_SIZE, FACE_SAMPLE_SIZE
  );
  return ctx.getImageData(0, 0, FACE_SAMPLE_SIZE, FACE_SAMPLE_SIZE).data;
}

function avgPixelDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]);
  return sum / (a.length / 4);
}

function getHeadTurnRatio(landmarks) {
  const avg = pts => ({
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  });
  const leftCenter  = avg(landmarks.getLeftEye());
  const rightCenter = avg(landmarks.getRightEye());
  const nose        = landmarks.getNose();
  const noseTip     = nose[nose.length - 1];          // bottom of nose
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  return dist(noseTip, leftCenter) / dist(noseTip, rightCenter);
}

// ── Page component ────────────────────────────────────────────────────────────

export default function TimeInOutPage() {
  const { branch } = useBranch();
  const { videoRef, ready, error } = useCamera();
  const canvasRef = useRef(null);

  const [modelsReady, setModelsReady] = useState(false);
  const [matcher, setMatcher]         = useState(null);
  const [employees, setEmployees]     = useState([]);
  const [scanning, setScanning]       = useState(false);
  const [message, setMessage]         = useState('');
  const [liveFrames, setLiveFrames]   = useState(0);    // Gate 1 progress
  const [turnDone, setTurnDone]       = useState(false); // Gate 2 confirmed

  const [pending, setPending]         = useState(null);
  const [lastResult, setLastResult]   = useState(null);

  // Refs to avoid stale closures inside setInterval
  const scanningRef       = useRef(false);
  const intervalRef       = useRef(null);
  const tickRunningRef    = useRef(false);
  const matcherRef        = useRef(null);
  const employeesRef      = useRef([]);
  // Gate 1
  const prevPixelsRef     = useRef(null);
  const liveFrameCountRef = useRef(0);
  const offscreenRef      = useRef(null);
  // Gate 2
  const turnFrameCountRef = useRef(0);
  const turnDoneRef       = useRef(false);  // avoids redundant setTurnDone calls

  useEffect(() => { matcherRef.current  = matcher;   }, [matcher]);
  useEffect(() => { employeesRef.current = employees; }, [employees]);

  useEffect(() => {
    const c = document.createElement('canvas');
    c.width  = FACE_SAMPLE_SIZE;
    c.height = FACE_SAMPLE_SIZE;
    offscreenRef.current = c;

    async function init() {
      await loadModels();
      setModelsReady(true);
      await refreshEmployees();
      // Background: silently pull latest face data from EmployeeSync sheet
      // so kiosks stay up-to-date without any admin action required.
      (async () => {
        try {
          const remote = await fetchEmployeesFromSheets();
          if (remote.length > 0) {
            const { added, updated } = await mergeEmployeesFromRemote(remote);
            if (added + updated > 0) await refreshEmployees();
          }
        } catch { /* no Apps Script URL configured or offline — safe to ignore */ }
      })();
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
      setMatcher(buildMatcher(labeled, 0.55));
    }
  }

  // ── Scan tick ────────────────────────────────────────────────────────────────

  const scanTick = useCallback(async () => {
    if (tickRunningRef.current || !videoRef.current || !modelsReady) return;
    tickRunningRef.current = true;

    try {
      const faceDet = await detectFaceWithLandmarks(videoRef.current);

      if (!faceDet) {
        setMessage('Position your face in the camera frame…');
        resetLiveness();
        tickRunningRef.current = false;
        return;
      }

      // ── Gate 1: pixel motion with stillness reset ─────────────────────────
      const box = faceDet.detection.box;
      const currentPixels = captureFacePixels(videoRef.current, box, offscreenRef.current);

      if (prevPixelsRef.current) {
        const diff = avgPixelDiff(currentPixels, prevPixelsRef.current);

        if (diff < STILL_THRESHOLD) {
          // Near-zero diff means a static image — reset presence counter
          liveFrameCountRef.current = 0;
          setLiveFrames(0);
        } else if (diff > MOTION_THRESHOLD) {
          liveFrameCountRef.current = Math.min(liveFrameCountRef.current + 1, REQUIRED_LIVE_FRAMES);
          setLiveFrames(liveFrameCountRef.current);
        }
      }
      prevPixelsRef.current = new Uint8ClampedArray(currentPixels);

      // ── Gate 2: head-turn landmark ratio ──────────────────────────────────
      if (!turnDoneRef.current) {
        const ratio    = getHeadTurnRatio(faceDet.landmarks);
        const isTurned = ratio < TURN_THRESHOLD || ratio > (1 / TURN_THRESHOLD);

        if (isTurned) {
          turnFrameCountRef.current = Math.min(turnFrameCountRef.current + 1, REQUIRED_TURN_FRAMES);
        } else {
          // Gradually release if they straighten — prevents counting a moment of jitter
          turnFrameCountRef.current = Math.max(turnFrameCountRef.current - 1, 0);
        }

        if (turnFrameCountRef.current >= REQUIRED_TURN_FRAMES) {
          turnDoneRef.current = true;
          setTurnDone(true);
        }
      }

      const presenceDone = liveFrameCountRef.current >= REQUIRED_LIVE_FRAMES;
      const gate2Done    = turnDoneRef.current;

      if (!presenceDone || !gate2Done) {
        if (!presenceDone) {
          setMessage('Look at the camera and hold still…');
        } else {
          setMessage('Turn your head slightly to either side…');
        }
        tickRunningRef.current = false;
        return;
      }

      // ── Both gates passed — run full descriptor match ─────────────────────
      setMessage('Identifying…');
      const detection = await detectSingleFaceDescriptor(videoRef.current);

      if (!detection) { tickRunningRef.current = false; return; }

      if (canvasRef.current) {
        drawDetections(canvasRef.current, videoRef.current, [detection]);
      }

      const m = matcherRef.current;
      if (!m) { tickRunningRef.current = false; return; }

      const match = m.findBestMatch(detection.descriptor);

      if (match.label === 'unknown') {
        setMessage('Face not recognised. Please try again or register.');
        resetLiveness();
        tickRunningRef.current = false;
        return;
      }

      stopScan();
      const emp = employeesRef.current.find((e) => String(e.id) === match.label);
      if (!emp) { tickRunningRef.current = false; return; }

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
    } finally {
      tickRunningRef.current = false;
    }
  }, [videoRef, modelsReady]);

  function resetLiveness() {
    prevPixelsRef.current     = null;
    liveFrameCountRef.current = 0;
    turnFrameCountRef.current = 0;
    turnDoneRef.current       = false;
    setLiveFrames(0);
    setTurnDone(false);
  }

  function startScan() {
    if (scanningRef.current) return;
    if (!matcherRef.current) {
      setMessage('No registered employees. Please register employees first.');
      return;
    }
    resetLiveness();
    setPending(null);
    setLastResult(null);
    setMessage('Look at the camera and hold still…');
    scanningRef.current = true;
    setScanning(true);
    intervalRef.current = setInterval(scanTick, SCAN_INTERVAL_MS);
  }

  function stopScan() {
    clearInterval(intervalRef.current);
    scanningRef.current = false;
    setScanning(false);
  }

  useEffect(() => () => clearInterval(intervalRef.current), []);

  // ── Confirmation handlers ─────────────────────────────────────────────────

  async function handleConfirm() {
    if (!pending) return;
    const { employee: emp, proposedAction, existingLog } = pending;
    const today = todayDateString();
    const now   = new Date().toISOString();

    let sheetsPayload = null;
    let sheetsFn      = pushLogToSheets;   // 'add' for Time In, 'update' for Time Out
    let savedLog      = null;              // full log object written to DB (for marking synced)

    if (proposedAction === 'Time In') {
      const logData = {
        employeeId: emp.id,
        branchCode: branch.code,
        branchIn:   branch.code,
        branchOut:  null,
        date:       today,
        timeIn:     now,
        timeOut:    null,
        synced:     false,
      };
      const logId = await addLog(logData);
      savedLog = { ...logData, id: logId };
      sheetsPayload = {
        uid:          emp.uid || `#${emp.id}`,
        employeeName: emp.name,
        date:         today,
        timeIn:       new Date(now).toLocaleTimeString(),
        timeOut:      '',
        branchIn:     branch.code,
        branchOut:    '',
        duration:     '',
      };
    } else if (proposedAction === 'Time Out') {
      savedLog = { ...existingLog, timeOut: now, branchOut: branch.code, synced: false };
      await saveLog(savedLog);
      sheetsPayload = {
        uid:          emp.uid || `#${emp.id}`,
        employeeName: emp.name,
        date:         today,
        timeIn:       new Date(savedLog.timeIn).toLocaleTimeString(),
        timeOut:      new Date(now).toLocaleTimeString(),
        branchIn:     savedLog.branchIn ?? savedLog.branchCode,
        branchOut:    branch.code,
        duration:     calcDuration(savedLog.timeIn, now),
      };
      sheetsFn = updateLogInSheets;  // update the existing row, not append
    }

    // Show result card immediately — don't wait for Sheets
    setLastResult({
      name:       emp.name,
      uid:        emp.uid || `#${emp.id}`,
      action:     proposedAction,
      time:       new Date().toLocaleTimeString(),
      syncStatus: sheetsPayload ? 'syncing' : 'idle',
    });
    setPending(null);

    // Push/update Sheets in the background and update sync status
    if (sheetsPayload && savedLog) {
      try {
        await sheetsFn(sheetsPayload);
        // Mark log as synced so "Sync Offline Logs" won't re-send it
        await saveLog({ ...savedLog, synced: true });
        setLastResult((r) => ({ ...r, syncStatus: 'synced' }));

        // Q3: After a completed Time Out, silently refresh the current period summary
        if (proposedAction === 'Time Out') {
          (async () => {
            try {
              const [allLogs, allEmps] = await Promise.all([getAllLogs(), getAllEmployees()]);
              const [period] = generatePeriodOptions();
              const rows = computePeriodSummary(
                allLogs, allEmps, period.year, period.month, period.half, getStandardHours()
              );
              if (rows.length > 0) await generateMonthlySummaryToSheets(period.label, rows);
            } catch { /* non-critical — summary will be regenerated manually if needed */ }
          })();
        }
      } catch {
        setLastResult((r) => ({ ...r, syncStatus: 'failed' }));
      }
    }
  }

  function handleCancelConfirm() {
    setPending(null);
    startScan();
  }

  const canScan        = modelsReady && ready && !!matcher;
  const presencePct    = Math.round((liveFrames / REQUIRED_LIVE_FRAMES) * 100);
  const turnPct        = Math.round((turnFrameCountRef.current / REQUIRED_TURN_FRAMES) * 100);

  // ── Render ────────────────────────────────────────────────────────────────

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

          {/* Liveness indicators */}
          {scanning && (
            <div className="space-y-2">
              {/* Gate 1 */}
              <div className="space-y-0.5">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Presence</span>
                  <span className={liveFrames >= REQUIRED_LIVE_FRAMES ? 'text-green-600 font-semibold' : ''}>
                    {liveFrames >= REQUIRED_LIVE_FRAMES ? '✓ Ready' : `${presencePct}%`}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-1.5 rounded-full transition-all duration-100"
                    style={{
                      width: `${presencePct}%`,
                      backgroundColor: liveFrames >= REQUIRED_LIVE_FRAMES ? '#16a34a' : '#d5006c',
                    }}
                  />
                </div>
              </div>
              {/* Gate 2 */}
              <div className="space-y-0.5">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Head turn  ← →</span>
                  <span className={turnDone ? 'text-green-600 font-semibold' : 'text-gray-400'}>
                    {turnDone ? '✓ Verified' : 'Turn head slightly'}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-1.5 rounded-full transition-all duration-100"
                    style={{
                      width: turnDone ? '100%' : `${turnPct}%`,
                      backgroundColor: turnDone ? '#16a34a' : '#d5006c',
                    }}
                  />
                </div>
              </div>
            </div>
          )}

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

        {/* Right column */}
        <div className="flex flex-col gap-4">

          {/* Confirmation card */}
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

          {/* Result card */}
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

              {/* Sheets sync status */}
              <div className="mt-2 text-xs">
                {lastResult.syncStatus === 'syncing' && (
                  <span className="text-gray-400">Syncing to Google Sheets…</span>
                )}
                {lastResult.syncStatus === 'synced' && (
                  <span className="text-green-600 font-medium">✓ Synced to Google Sheets</span>
                )}
                {lastResult.syncStatus === 'failed' && (
                  <span className="text-amber-600 font-medium">⚠ Saved locally — will sync when online</span>
                )}
              </div>

              <button
                onClick={startScan}
                className="mt-4 bg-brand hover:bg-brand-dark text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                Scan Next
              </button>
            </div>
          )}

          {/* Idle placeholder */}
          {!pending && !lastResult && (
            <div className="rounded-xl p-6 bg-white border border-gray-100 shadow-sm text-center text-gray-400 text-sm">
              <div className="text-5xl mb-3">👤</div>
              <p>Press <strong>Start Scan</strong> and look at the camera.</p>
              <p className="text-xs mt-1 text-gray-300">Then turn your head slightly left or right.</p>
            </div>
          )}

          {/* Employee roster */}
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
