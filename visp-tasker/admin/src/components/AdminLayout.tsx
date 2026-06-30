import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import LangSwitcher from './LangSwitcher';

const navItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '9px 12px',
  borderRadius: 6,
  fontSize: 13.5,
  fontWeight: 500,
  letterSpacing: '-0.005em',
  textDecoration: 'none',
  transition: 'color .15s, background-color .15s',
};

export default function AdminLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    navigate('/console', { replace: true });
  };

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--t-bg)' }}>
      <VispMark />

      <aside
        className="shrink-0 flex flex-col"
        style={{
          width: 248,
          background: 'var(--t-surface)',
          borderRight: '1px solid var(--t-border)',
        }}
      >
        {/* Brand */}
        <div
          className="flex items-center gap-3"
          style={{ padding: '18px 18px', borderBottom: '1px solid var(--t-border)' }}
        >
          <svg style={{ width: 28, height: 28 }}><use href="#visp-mark" /></svg>
          <div className="leading-tight">
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--t-text)' }}>
              VISP
            </div>
            <div className="t-mono" style={{ fontSize: 9.5, color: 'var(--t-text-3)', letterSpacing: '0.16em', textTransform: 'uppercase' }}>
              Admin Console
            </div>
          </div>
        </div>

        {/* Section label */}
        <div style={{ padding: '20px 18px 8px' }}>
          <span className="t-eyebrow">§ Workspace</span>
        </div>

        {/* Nav */}
        <nav className="flex-1" style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <NavLink
            end
            to="/admin"
            style={({ isActive }) => ({
              ...navItemStyle,
              color: isActive ? 'var(--t-text)' : 'var(--t-text-2)',
              background: isActive ? 'var(--t-card)' : 'transparent',
              borderLeft: isActive ? '2px solid var(--t-violet)' : '2px solid transparent',
              paddingLeft: 10,
            })}
          >
            <NavIcon name="dashboard" />
            <span>{t('nav.dashboard')}</span>
          </NavLink>

          <NavLink
            to="/admin/services"
            style={({ isActive }) => ({
              ...navItemStyle,
              color: isActive ? 'var(--t-text)' : 'var(--t-text-2)',
              background: isActive ? 'var(--t-card)' : 'transparent',
              borderLeft: isActive ? '2px solid var(--t-violet)' : '2px solid transparent',
              paddingLeft: 10,
            })}
          >
            <NavIcon name="services" />
            <span>{t('nav.services')}</span>
          </NavLink>

          <NavLink
            to="/admin/documents"
            style={({ isActive }) => ({
              ...navItemStyle,
              color: isActive ? 'var(--t-text)' : 'var(--t-text-2)',
              background: isActive ? 'var(--t-card)' : 'transparent',
              borderLeft: isActive ? '2px solid var(--t-violet)' : '2px solid transparent',
              paddingLeft: 10,
            })}
          >
            <NavIcon name="documents" />
            <span>{t('nav.documents')}</span>
          </NavLink>

          <NavLink
            to="/admin/businesses"
            style={({ isActive }) => ({
              ...navItemStyle,
              color: isActive ? 'var(--t-text)' : 'var(--t-text-2)',
              background: isActive ? 'var(--t-card)' : 'transparent',
              borderLeft: isActive ? '2px solid var(--t-violet)' : '2px solid transparent',
              paddingLeft: 10,
            })}
          >
            <NavIcon name="businesses" />
            <span>{t('nav.businesses', 'Businesses')}</span>
          </NavLink>

          <NavLink
            to="/admin/promotions"
            style={({ isActive }) => ({
              ...navItemStyle,
              color: isActive ? 'var(--t-text)' : 'var(--t-text-2)',
              background: isActive ? 'var(--t-card)' : 'transparent',
              borderLeft: isActive ? '2px solid var(--t-violet)' : '2px solid transparent',
              paddingLeft: 10,
            })}
          >
            <NavIcon name="promotions" />
            <span>{t('nav.promotions')}</span>
          </NavLink>

          {user?.role === 'super_admin' && (
            <>
              <NavLink
                to="/admin/users"
                style={({ isActive }) => ({
                  ...navItemStyle,
                  color: isActive ? 'var(--t-text)' : 'var(--t-text-2)',
                  background: isActive ? 'var(--t-card)' : 'transparent',
                  borderLeft: isActive ? '2px solid var(--t-violet)' : '2px solid transparent',
                  paddingLeft: 10,
                })}
              >
                <NavIcon name="users" />
                <span>{t('nav.users')}</span>
              </NavLink>
              <NavLink
                to="/admin/admins"
                style={({ isActive }) => ({
                  ...navItemStyle,
                  color: isActive ? 'var(--t-text)' : 'var(--t-text-2)',
                  background: isActive ? 'var(--t-card)' : 'transparent',
                  borderLeft: isActive ? '2px solid var(--t-violet)' : '2px solid transparent',
                  paddingLeft: 10,
                })}
              >
                <NavIcon name="admins" />
                <span>{t('nav.admins')}</span>
              </NavLink>
            </>
          )}
        </nav>

        {/* User footer */}
        <div style={{ padding: 16, borderTop: '1px solid var(--t-border)' }}>
          <div
            className="t-mono"
            style={{ fontSize: 10, color: 'var(--t-text-4)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}
          >
            Signed in as
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-text)', marginBottom: 2 }}>
            {user ? `${user.firstName} ${user.lastName}` : ''}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--t-text-3)', marginBottom: 12, wordBreak: 'break-all' }}>
            {user?.email}
          </div>
          <div className="flex items-center justify-between gap-2">
            <LangSwitcher />
            <button
              type="button"
              onClick={handleLogout}
              className="t-btn t-btn-ghost t-btn-sm"
              style={{ color: 'var(--t-danger)' }}
            >
              {t('nav.logout')}
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto" style={{ background: 'var(--t-bg)' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '32px 32px 64px' }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function NavIcon({ name }: { name: 'dashboard' | 'documents' | 'businesses' | 'promotions' | 'admins' | 'services' | 'users' }) {
  const props = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'dashboard':
      return (
        <svg {...props}>
          <rect x="3" y="3" width="7" height="9" />
          <rect x="14" y="3" width="7" height="5" />
          <rect x="14" y="12" width="7" height="9" />
          <rect x="3" y="16" width="7" height="5" />
        </svg>
      );
    case 'services':
      return (
        <svg {...props}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      );
    case 'documents':
      return (
        <svg {...props}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14,2 14,8 20,8" />
          <line x1="8" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="14" y2="17" />
        </svg>
      );
    case 'businesses':
      return (
        <svg {...props}>
          <path d="M3 21h18" />
          <path d="M5 21V7l8-4v18" />
          <path d="M19 21V11l-6-4" />
          <line x1="9" y1="9" x2="9" y2="9.01" />
          <line x1="9" y1="12" x2="9" y2="12.01" />
          <line x1="9" y1="15" x2="9" y2="15.01" />
        </svg>
      );
    case 'promotions':
      return (
        <svg {...props}>
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      );
    case 'admins':
      return (
        <svg {...props}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'users':
      return (
        <svg {...props}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      );
  }
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
