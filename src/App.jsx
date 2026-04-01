import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { BranchProvider } from './context/BranchContext';
import Navbar from './components/Navbar';
import ProtectedRoute, { AdminRoute } from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import RegisterPage from './pages/RegisterPage';
import TimeInOutPage from './pages/TimeInOutPage';
import AdminPage from './pages/AdminPage';
import { clearLocalCacheOnStartup } from './lib/db';

export default function App() {
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    // Clear stale cached data from the previous session before rendering.
    // Employees are re-fetched from Sheets; only unsynced logs are kept.
    clearLocalCacheOnStartup()
      .catch(() => {}) // DB not yet created on very first run — ignore
      .finally(() => setInitializing(false));
  }, []);

  if (initializing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-50 to-pink-100 flex items-center justify-center">
        <div className="text-center">
          <div
            className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin mx-auto mb-3"
            style={{ borderColor: '#d5006c', borderTopColor: 'transparent' }}
          />
          <p className="text-sm text-gray-500">Starting up…</p>
        </div>
      </div>
    );
  }

  return (
    <BranchProvider>
      <BrowserRouter>
        <div className="min-h-screen flex flex-col bg-slate-100">
          <Navbar />
          <main className="flex-1">
            <Routes>
              <Route path="/" element={<LoginPage />} />
              <Route
                path="/dashboard"
                element={<AdminRoute><DashboardPage /></AdminRoute>}
              />
              <Route
                path="/timeinout"
                element={<ProtectedRoute><TimeInOutPage /></ProtectedRoute>}
              />
              <Route
                path="/register"
                element={<AdminRoute><RegisterPage /></AdminRoute>}
              />
              <Route
                path="/admin"
                element={<AdminRoute><AdminPage /></AdminRoute>}
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </BranchProvider>
  );
}
