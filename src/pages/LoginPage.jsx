import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBranch } from '../context/BranchContext';
import { getBranch, hashPin } from '../lib/db';
import { fetchBranchesFromSheets, getAppsScriptUrl } from '../lib/sheets';

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

      // SUPER-ADMIN is a system account — always verified locally
      if (code === 'SUPER-ADMIN') {
        const admin = await getBranch('SUPER-ADMIN');
        const hashed = await hashPin(pin);
        if (!admin || admin.pin !== hashed) {
          setError('Incorrect admin code or PIN.');
          return;
        }
        setBranch({ code: admin.code, name: admin.name, isAdmin: true });
        navigate('/dashboard');
        return;
      }

      // All branch accounts are verified live against Google Sheets
      if (!getAppsScriptUrl()) {
        setError('This system is not configured yet. Contact your administrator.');
        return;
      }

      let branches;
      try {
        branches = await fetchBranchesFromSheets();
      } catch {
        setError('No internet connection. This app requires an active internet connection to sign in.');
        return;
      }

      const account = branches.find((b) => b.code === code);
      if (!account) {
        setError('Account not found. Check your branch code or contact your administrator.');
        return;
      }

      if (account.pin) {
        const hashed = await hashPin(pin);
        if (account.pin !== hashed) {
          setError('Incorrect PIN.');
          return;
        }
      }

      const isAdmin = account.isAdmin ?? false;
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

        <p className="mt-6 text-center text-xs text-gray-400">
          Contact your administrator to obtain your branch code.
        </p>
      </div>
    </div>
  );
}
