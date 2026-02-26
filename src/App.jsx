import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { BranchProvider } from './context/BranchContext';
import Navbar from './components/Navbar';
import ProtectedRoute, { AdminRoute } from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import RegisterPage from './pages/RegisterPage';
import TimeInOutPage from './pages/TimeInOutPage';
import AdminPage from './pages/AdminPage';

export default function App() {
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
