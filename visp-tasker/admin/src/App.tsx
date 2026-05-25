import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import Landing from '@/pages/public/Landing';
import StripeReturn from '@/pages/public/StripeReturn';
import StripeRefresh from '@/pages/public/StripeRefresh';
import Login from '@/pages/auth/Login';
import RedeemInvite from '@/pages/auth/RedeemInvite';
import RedeemReset from '@/pages/auth/RedeemReset';
import AdminLayout from '@/components/AdminLayout';
import Dashboard from '@/pages/admin/Dashboard';
import Documents from '@/pages/admin/Documents';
import Services from '@/pages/admin/Services';
import Users from '@/pages/admin/Users';
import Promotions from '@/pages/admin/Promotions';
import Admins from '@/pages/admin/Admins';

function ProtectedRoute({ children }: { children: JSX.Element }) {
  const { isAuthenticated, isHydrating } = useAuthStore();
  if (isHydrating) {
    return (
      <div className="h-full grid place-items-center text-textSecondary">
        Loading…
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/console" replace />;
  return children;
}

function SuperAdminRoute({ children }: { children: JSX.Element }) {
  const { user } = useAuthStore();
  if (!user || user.role !== 'super_admin') {
    return <Navigate to="/admin" replace />;
  }
  return children;
}

export default function App() {
  const hydrate = useAuthStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <Routes>
      {/* Public landing (also Stripe return target) */}
      <Route path="/" element={<Landing />} />
      <Route path="/stripe/return" element={<StripeReturn />} />
      <Route path="/stripe/refresh" element={<StripeRefresh />} />

      {/* Hidden login at /console — not linked from anywhere */}
      <Route path="/console" element={<Login />} />
      <Route path="/console/invite" element={<RedeemInvite />} />
      <Route path="/console/reset" element={<RedeemReset />} />

      {/* Protected admin shell */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="services" element={<Services />} />
        <Route path="documents" element={<Documents />} />
        <Route
          path="users"
          element={
            <SuperAdminRoute>
              <Users />
            </SuperAdminRoute>
          }
        />
        <Route path="promotions" element={<Promotions />} />
        <Route path="admins" element={<Admins />} />
      </Route>

      {/* 404 fallback → landing */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
