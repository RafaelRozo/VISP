import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import LangSwitcher from '@/components/LangSwitcher';

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated, isHydrating, login, error, clearError } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate('/admin', { replace: true });
  }, [isAuthenticated, navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setSubmitting(true);
    clearError();
    try {
      await login(email, password);
      navigate('/admin', { replace: true });
    } catch {
      // error already in the store
    } finally {
      setSubmitting(false);
    }
  };

  if (isHydrating) {
    return (
      <div className="min-h-screen grid place-items-center" style={{ color: 'var(--t-text-2)' }}>
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--t-bg)' }}>
      <VispMark />

      {/* Top bar */}
      <header
        className="flex items-center justify-between px-6 lg:px-10"
        style={{ height: 64, borderBottom: '1px solid var(--t-border)' }}
      >
        <Link to="/" className="flex items-center gap-3" style={{ color: 'var(--t-text)' }}>
          <svg style={{ width: 28, height: 28 }}><use href="#visp-mark" /></svg>
          <div className="leading-tight">
            <div className="font-bold" style={{ fontSize: 16, letterSpacing: '0.04em' }}>
              VISP
            </div>
            <div className="t-mono" style={{ fontSize: 10, color: 'var(--t-text-3)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Admin Console
            </div>
          </div>
        </Link>
        <LangSwitcher />
      </header>

      {/* Form */}
      <div className="flex-1 grid place-items-center px-6 py-12">
        <div style={{ width: '100%', maxWidth: 420 }}>
          <div style={{ marginBottom: 32 }}>
            <span className="t-eyebrow">§ {t('login.title')}</span>
            <h1 className="t-h1" style={{ marginTop: 12 }}>
              {t('login.title')}
            </h1>
            <p className="t-lede" style={{ marginTop: 10 }}>
              {t('login.subtitle')}
            </p>
          </div>

          <form
            onSubmit={onSubmit}
            className="t-card-base"
            style={{ padding: 28 }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label className="t-label" htmlFor="email">{t('login.email')}</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="t-input"
                />
              </div>
              <div>
                <label className="t-label" htmlFor="password">{t('login.password')}</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="t-input"
                />
              </div>
            </div>

            {error && (
              <div
                style={{
                  marginTop: 18,
                  padding: '11px 14px',
                  borderRadius: 'var(--t-r)',
                  border: '1px solid rgba(252,129,129,0.30)',
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
              {submitting ? (
                <>
                  <span className="t-spinner" /> {t('common.loading')}
                </>
              ) : (
                t('login.signIn')
              )}
            </button>

            <div
              style={{
                marginTop: 18,
                paddingTop: 18,
                borderTop: '1px solid var(--t-border)',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12,
                color: 'var(--t-text-3)',
              }}
            >
              <Link to="/console/invite" style={{ color: 'var(--t-text-2)' }} className="hover:!text-white">
                {t('login.firstTime')}
              </Link>
              <Link to="/console/reset" style={{ color: 'var(--t-text-2)' }} className="hover:!text-white">
                {t('login.forgotPassword')}
              </Link>
            </div>
          </form>

          <p
            className="t-mono"
            style={{ marginTop: 24, textAlign: 'center', fontSize: 10.5, color: 'var(--t-text-4)', letterSpacing: '0.14em', textTransform: 'uppercase' }}
          >
            VISP TECHNOLOGIES · Verified Local Services
          </p>
        </div>
      </div>
    </div>
  );
}

function VispMark() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="visp-mark" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="26" fill="none" stroke="#2A2A2A" strokeWidth="2.5" />
          <path d="M 32 6 A 26 26 0 0 1 26 57.3" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M 9.2 22.5 A 26 26 0 0 1 12.5 16.4" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M 19.5 22 L 32 45 L 44.5 22" fill="none" stroke="#FFFFFF" strokeWidth="5.5" strokeLinejoin="miter" strokeLinecap="butt" />
        </symbol>
      </defs>
    </svg>
  );
}
