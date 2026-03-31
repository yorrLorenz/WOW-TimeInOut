import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBranch } from '../context/BranchContext';
import { getBranch, saveBranch } from '../lib/db';

const DEFAULT_BRANCHES = [
  { code: 'MAIN-001', name: 'Main Branch' },
  { code: 'NORTH-002', name: 'North Branch' },
  { code: 'SOUTH-003', name: 'South Branch' },
];

export default function LoginPage() {
  const { setBranch } = useBranch();
  const navigate = useNavigate();

  const [accountCode, setAccountCode] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const code = accountCode.trim().toUpperCase();
      if (!code) {
        setError('Please enter your branch code or admin code.');
        return;
      }

      let account = await getBranch(code);

      // Auto-create known default branches on first run
      if (!account) {
        const defaultBranch = DEFAULT_BRANCHES.find((b) => b.code === code);
        if (defaultBranch) {
          await saveBranch({ ...defaultBranch, pin: '1234' });
          account = { ...defaultBranch, pin: '1234' };
        }
      }

      if (!account) {
        setError('Account not found. Check your branch code or contact your administrator.');
        return;
      }

      if (account.pin && account.pin !== pin) {
        setError('Incorrect PIN.');
        return;
      }

      const isAdmin = account.isAdmin ?? false;
      // Store minimal context — never the PIN
      setBranch({ code: account.code, name: account.name, isAdmin });
      navigate(isAdmin ? '/dashboard' : '/timeinout');
    } catch (err) {
      setError('Login failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-light to-pink-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand rounded-full mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">TimeIn</h1>
          <p className="text-gray-500 text-sm mt-1">Employee Attendance System</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Account Code
            </label>
            <input
              type="text"
              value={accountCode}
              onChange={(e) => setAccountCode(e.target.value)}
              placeholder="e.g. MAIN-001"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand uppercase"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              PIN
            </label>
            <div className="relative">
              <input
                type={showPin ? 'text' : 'password'}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter PIN"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
              <button
                type="button"
                onClick={() => setShowPin((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {showPin ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand hover:bg-brand-dark text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-60"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 p-3 bg-gray-50 rounded-lg text-xs text-gray-500">
          <p className="font-medium mb-1">Branch codes (default PIN: 1234):</p>
          {DEFAULT_BRANCHES.map((b) => (
            <button
              key={b.code}
              type="button"
              onClick={() => setAccountCode(b.code)}
              className="block hover:text-brand transition-colors"
            >
              {b.code} — {b.name} 
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
