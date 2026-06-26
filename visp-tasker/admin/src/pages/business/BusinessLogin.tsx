/**
 * /business/login — owner sign-in for "VISP for Business".
 * Authenticates the standard user via /auth/login, then routes to /business.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBusinessStore } from '@/stores/businessStore';
import { BusinessTopBar, VispSprite } from './BusinessChrome';

export default function BusinessLogin() {
  const navigate = useNavigate();
  const { login, isAuthenticated, isHydrating, error, clearError } = useBusinessStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isHydrating && isAuthenticated) navigate('/business', { replace: true });
  }, [isHydrating, isAuthenticated, navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setSubmitting(true);
    clearError();
    try {
      await login(email, password);
      navigate('/business', { replace: true });
    } catch {
      // error already in store
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--t-bg)' }}>
      <VispSprite />
      <BusinessTopBar />

      <div className="flex-1 grid place-items-center px-6 py-12">
        <div style={{ width: '100%', maxWidth: 420 }}>
          <div style={{ marginBottom: 28 }}>
            <span className="t-eyebrow">§ For Business</span>
            <h1 className="t-h1" style={{ marginTop: 12 }}>
              Sign in
            </h1>
            <p className="t-lede" style={{ marginTop: 10 }}>
              Manage your company, services and team.
            </p>
          </div>

          <form className="t-card-base" style={{ padding: 28 }} onSubmit={onSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label className="t-label">Email</label>
                <input
                  className="t-input"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="t-label">Password</label>
                <input
                  className="t-input"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <div
                style={{
                  marginTop: 16,
                  padding: '12px 14px',
                  borderRadius: 8,
                  border: '1px solid rgba(252,129,129,0.3)',
                  background: 'rgba(252,129,129,0.08)',
                  color: 'var(--t-danger)',
                  fontSize: 13,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="t-btn t-btn-primary t-btn-lg"
              style={{ width: '100%', marginTop: 22 }}
            >
              {submitting && <span className="t-spinner" />}
              Sign in
            </button>
          </form>

          <p className="t-meta" style={{ marginTop: 18, textAlign: 'center' }}>
            New here?{' '}
            <Link to="/business/register" style={{ color: 'var(--t-violet)' }}>
              Register for Business
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
