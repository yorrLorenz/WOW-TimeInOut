import { useState, useRef, useEffect, useCallback } from 'react';
import { useBranch } from '../context/BranchContext';
import { useCamera } from '../hooks/useCamera';
import CameraView from '../components/CameraView';
import { loadModels, detectSingleFaceDescriptor, descriptorToArray } from '../lib/faceApi';
import { registerEmployee, getAllEmployees, getAllBranches } from '../lib/db';

const CAPTURE_COUNT = 5; // number of samples per registration

export default function RegisterPage() {
  const { branch } = useBranch();
  const { videoRef, ready, error } = useCamera();
  const canvasRef = useRef(null);

  const [name, setName] = useState('');
  const [position, setPosition] = useState('');
  const [modelsReady, setModelsReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captures, setCaptures] = useState([]); // array of descriptor arrays
  const [status, setStatus] = useState('');
  const [employees, setEmployees] = useState([]);
  const [saving, setSaving] = useState(false);
  const [allBranches, setAllBranches] = useState([]);
  const [branchFilter, setBranchFilter] = useState('ALL');

  useEffect(() => {
    loadModels().then(() => setModelsReady(true));
    refreshEmployees();
    getAllBranches().then((bs) =>
      setAllBranches(bs.filter((b) => b.code !== 'SUPER-ADMIN'))
    );
  }, []);

  async function refreshEmployees() {
    const list = await getAllEmployees();
    setEmployees(list);
  }

  const captureDescriptor = useCallback(async () => {
    if (!videoRef.current || !modelsReady) return null;
    const detection = await detectSingleFaceDescriptor(videoRef.current);
    if (!detection) {
      setStatus('No face detected — make sure your face is clearly visible.');
      return null;
    }
    return descriptorToArray(detection.descriptor);
  }, [videoRef, modelsReady]);

  async function handleCapture() {
    if (!name.trim()) {
      setStatus('Please enter the employee name first.');
      return;
    }
    setCapturing(true);
    setStatus('Capturing face samples…');
    const newCaptures = [];
    for (let i = 0; i < CAPTURE_COUNT; i++) {
      setStatus(`Capturing sample ${i + 1} of ${CAPTURE_COUNT}…`);
      await new Promise((r) => setTimeout(r, 600));
      const desc = await captureDescriptor();
      if (desc) newCaptures.push(desc);
    }
    setCaptures(newCaptures);
    if (newCaptures.length >= 3) {
      setStatus(`Captured ${newCaptures.length} samples. You can add more samples (e.g. with glasses) or click "Save Employee".`);
    } else {
      setStatus(`Only ${newCaptures.length} samples captured. Try again with better lighting.`);
    }
    setCapturing(false);
  }

  async function handleCaptureMore() {
    setCapturing(true);
    setStatus('Capturing additional samples…');
    const extra = [];
    for (let i = 0; i < CAPTURE_COUNT; i++) {
      setStatus(`Capturing additional sample ${i + 1} of ${CAPTURE_COUNT}…`);
      await new Promise((r) => setTimeout(r, 600));
      const desc = await captureDescriptor();
      if (desc) extra.push(desc);
    }
    const total = captures.length + extra.length;
    setCaptures((prev) => [...prev, ...extra]);
    setStatus(`Total: ${total} samples captured. Click "Save Employee" to register.`);
    setCapturing(false);
  }

  async function handleSave() {
    if (!name.trim()) { setStatus('Name is required.'); return; }
    if (captures.length < 3) { setStatus('Please capture at least 3 face samples.'); return; }
    setSaving(true);
    try {
      await registerEmployee({
        name: name.trim(),
        position: position.trim(),
        homeBranch: branch.isAdmin ? null : branch.code,
        descriptors: captures,
        createdAt: new Date().toISOString(),
      });
      setStatus('Employee registered successfully!');
      setName('');
      setPosition('');
      setCaptures([]);
      await refreshEmployees();
    } catch (err) {
      setStatus('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Employee Registration</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Camera + capture */}
        <div className="space-y-4">
          <CameraView
            videoRef={videoRef}
            canvasRef={canvasRef}
            ready={ready}
            error={error}
            className="aspect-video"
          />

          <div className="space-y-2">
            <input
              type="text"
              placeholder="Full Name *"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <input
              type="text"
              placeholder="Position / Role"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>

          {/* Capture progress */}
          {captures.length > 0 && (
            <div className="space-y-1">
              <div className="flex gap-1">
                {Array.from({ length: Math.max(captures.length, CAPTURE_COUNT) }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-2 flex-1 rounded-full ${
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

          <div className="flex gap-2">
            <button
              onClick={captures.length === 0 ? handleCapture : handleCaptureMore}
              disabled={capturing || !ready || !modelsReady}
              className="flex-1 bg-brand hover:bg-brand-dark text-white font-semibold py-2 rounded-lg text-sm transition-colors disabled:opacity-60"
            >
              {capturing ? 'Capturing…' : captures.length === 0 ? 'Capture Face' : '+ More Samples'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || captures.length < 3}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded-lg text-sm transition-colors disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save Employee'}
            </button>
          </div>

          {captures.length >= 3 && (
            <p className="text-xs text-gray-400 text-center">
              Tip: capture again with/without glasses or a different angle to improve recognition accuracy.
            </p>
          )}

          {!modelsReady && (
            <p className="text-xs text-gray-400 text-center">Loading face recognition models…</p>
          )}
        </div>

        {/* Employee list */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
            <h2 className="font-semibold text-gray-700 shrink-0">
              Employees ({employees.length})
            </h2>
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-600 focus:outline-none"
            >
              <option value="ALL">All Branches</option>
              {allBranches.map((b) => (
                <option key={b.code} value={b.code}>{b.name}</option>
              ))}
            </select>
          </div>

          {employees.filter(
            (e) => branchFilter === 'ALL' || e.homeBranch === branchFilter
          ).length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-3xl mb-2">👤</div>
              <p className="text-sm text-gray-400">No employees registered yet.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50 overflow-y-auto max-h-96">
              {employees
                .filter((e) => branchFilter === 'ALL' || e.homeBranch === branchFilter)
                .map((emp) => (
                  <li key={emp.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-brand-light flex items-center justify-center text-brand font-bold text-sm shrink-0">
                      {emp.name[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800 text-sm truncate">{emp.name}</p>
                      <p className="text-xs text-gray-500">
                        {emp.position || 'No position'} &bull; {emp.descriptors?.length ?? 0} samples
                        {emp.uid && (
                          <span className="ml-1 font-mono text-brand">{emp.uid}</span>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
