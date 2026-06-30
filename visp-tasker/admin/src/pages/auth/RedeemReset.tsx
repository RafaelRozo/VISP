import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { adminService } from '@/services/adminService';
import { setAdminTokens } from '@/services/apiClient';
import { useAuthStore } from '@/stores/authStore';
import LangSwitcher from '@/components/LangSwitcher';
import Logo from '@/components/Logo';
import PasswordRules from '@/components/PasswordRules';
import { firstFailingRule } from '@/lib/passwordPolicy';

export default function RedeemReset() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const hydrate = useAuthStore((s) => s.hydrate);

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t('redeem.passwordMismatch'));
      return;
    }
    if (firstFailingRule(password) !== null) {
      setError(t('redeem.passwordWeak'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await adminService.redeemReset({
        email: email.trim().toLowerCase(),
        code: code.trim().toUpperCase(),
        password,
      });
      setAdminTokens(res.tokens.accessToken, res.tokens.refreshToken);
      await hydrate();
      navigate('/admin', { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Logo size={28} />
          <span className="font-semibold tracking-wide">
            {t('common.appName')}
          </span>
        </div>
        <LangSwitcher />
      </header>

      <div className="flex-1 grid place-items-center px-6 pb-10">
        <form onSubmit={onSubmit} className="glass p-8 w-full max-w-md">
          <h1 className="text-2xl font-bold">{t('redeem.resetTitle')}</h1>
          <p className="mt-1 text-sm text-textSecondary">
            {t('redeem.resetSubtitle')}
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="label">{t('login.email')}</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="label">{t('redeem.code')}</label>
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="input font-mono tracking-widest"
                maxLength={20}
              />
            </div>
            <div>
              <label className="label">{t('redeem.newPassword')}</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                autoComplete="new-password"
              />
              <PasswordRules password={password} />
            </div>
            <div>
              <label className="label">{t('redeem.confirmPassword')}</label>
              <input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="input"
                autoComplete="new-password"
              />
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="glow-button w-full mt-6 disabled:opacity-60"
          >
            {submitting ? t('common.loading') : t('redeem.resetPassword')}
          </button>

          <div className="mt-4 text-center">
            <Link to="/console" className="text-xs text-textSecondary hover:text-white transition">
              {t('redeem.backToLogin')}
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
