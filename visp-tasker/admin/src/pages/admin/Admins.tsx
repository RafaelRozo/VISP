import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminService,
  GeneratedCode,
  SuperuserRow,
} from '@/services/adminService';
import { useAuthStore } from '@/stores/authStore';

type InviteForm = {
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'super_admin';
};

const emptyInvite: InviteForm = {
  email: '',
  firstName: '',
  lastName: '',
  role: 'admin',
};

function CodeRevealModal({
  code,
  email,
  expiresAt,
  onClose,
}: {
  code: GeneratedCode;
  email: string;
  expiresAt: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="glass max-w-md w-full p-6 space-y-4">
        <h3 className="text-xl font-bold">{t('admins.codeGenerated')}</h3>
        <p className="text-sm text-textSecondary">
          {t('admins.codeWarning')}
        </p>
        <div className="rounded-xl border border-primary/40 bg-primary/10 p-4 text-center">
          <div className="text-xs uppercase tracking-widest text-textSecondary mb-2">
            {email}
          </div>
          <div className="text-3xl font-mono font-bold tracking-widest break-all">
            {code.code}
          </div>
          <div className="mt-2 text-xs text-textTertiary">
            {t('admins.expiresAt')}: {new Date(expiresAt).toLocaleString()}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copy}
            className="flex-1 rounded-xl bg-primary text-white px-4 py-2.5 text-sm font-semibold hover:bg-primary/90 transition"
          >
            {copied ? t('admins.copied') : t('admins.copy')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl ghost-button text-sm font-semibold"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Admins() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user: currentAdmin } = useAuthStore();
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState<InviteForm>(emptyInvite);
  const [revealed, setRevealed] = useState<{
    code: GeneratedCode;
    email: string;
    expiresAt: string;
  } | null>(null);

  const q = useQuery<SuperuserRow[]>({
    queryKey: ['superusers'],
    queryFn: () => adminService.listSuperusers(),
  });

  const invite = useMutation({
    mutationFn: (body: InviteForm) => adminService.inviteSuperuser(body),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['superusers'] });
      setRevealed({ code: data, email: vars.email, expiresAt: data.expiresAt });
      setForm(emptyInvite);
      setShowInvite(false);
    },
  });

  const reset = useMutation({
    mutationFn: (id: string) => adminService.createResetCode(id),
    onSuccess: (data) => {
      setRevealed({ code: data, email: data.email, expiresAt: data.expiresAt });
    },
  });

  const toggleActive = useMutation({
    mutationFn: (id: string) => adminService.toggleSuperuserActive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['superusers'] }),
  });

  const del = useMutation({
    mutationFn: (id: string) => adminService.deleteSuperuser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['superusers'] }),
  });

  const isSuper = currentAdmin?.role === 'super_admin';
  const rows = q.data ?? [];

  if (!isSuper) {
    return (
      <div className="glass p-10 text-center text-textSecondary">
        {t('admins.onlySuperAdmin')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t('admins.title')}</h1>
        <button
          type="button"
          onClick={() => setShowInvite((v) => !v)}
          className="rounded-xl bg-primary text-white px-5 py-2.5 text-sm font-semibold hover:bg-primary/90 transition"
        >
          {showInvite ? t('common.cancel') : t('admins.invite')}
        </button>
      </div>

      {showInvite && (
        <div className="glass p-5 space-y-3">
          <h2 className="text-lg font-semibold">{t('admins.newInvite')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              className="input"
              placeholder={t('admins.firstName')}
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            />
            <input
              className="input"
              placeholder={t('admins.lastName')}
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            />
            <input
              className="input sm:col-span-2"
              type="email"
              placeholder={t('admins.email')}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <select
              className="input sm:col-span-2"
              value={form.role}
              onChange={(e) =>
                setForm({ ...form, role: e.target.value as InviteForm['role'] })
              }
            >
              <option value="admin">{t('admins.roleAdmin')}</option>
              <option value="super_admin">{t('admins.roleSuperAdmin')}</option>
            </select>
          </div>
          {invite.isError && (
            <div className="text-sm text-danger">
              {(invite.error as Error)?.message ?? t('common.error')}
            </div>
          )}
          <button
            type="button"
            disabled={
              !form.email.trim() ||
              !form.firstName.trim() ||
              !form.lastName.trim() ||
              invite.isPending
            }
            onClick={() => invite.mutate(form)}
            className="rounded-xl bg-primary text-white px-5 py-2.5 text-sm font-semibold disabled:opacity-50 hover:bg-primary/90 transition"
          >
            {invite.isPending ? t('common.loading') : t('admins.generateCode')}
          </button>
        </div>
      )}

      {q.isLoading && (
        <div className="text-textSecondary">{t('common.loading')}</div>
      )}

      {!q.isLoading && rows.length === 0 && (
        <div className="glass p-10 text-center text-textSecondary">
          {t('admins.empty')}
        </div>
      )}

      <div className="grid gap-3">
        {rows.map((su) => {
          const isSelf = su.id === currentAdmin?.id;
          return (
            <div key={su.id} className="glass p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">
                  {su.firstName} {su.lastName}
                  {isSelf && (
                    <span className="ml-2 text-xs text-primary">
                      ({t('admins.you')})
                    </span>
                  )}
                </div>
                <div className="text-sm text-textSecondary truncate">
                  {su.email}
                </div>
                <div className="text-xs text-textTertiary mt-1">
                  {su.role} ·{' '}
                  {su.isActive ? t('admins.active') : t('admins.disabled')}
                  {su.lastLoginAt &&
                    ` · ${t('admins.lastLogin')}: ${new Date(
                      su.lastLoginAt,
                    ).toLocaleString()}`}
                </div>
              </div>
              {!isSelf && (
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <button
                    type="button"
                    onClick={() => reset.mutate(su.id)}
                    disabled={reset.isPending}
                    className="rounded-xl bg-warning/20 border border-warning/40 text-warning px-3 py-2 text-xs font-semibold hover:bg-warning/30 transition disabled:opacity-50"
                  >
                    {t('admins.resetCode')}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleActive.mutate(su.id)}
                    disabled={toggleActive.isPending}
                    className="rounded-xl ghost-button text-xs"
                  >
                    {su.isActive ? t('admins.disable') : t('admins.enable')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(t('admins.deleteConfirm'))) {
                        del.mutate(su.id);
                      }
                    }}
                    disabled={del.isPending}
                    className="rounded-xl bg-danger/20 border border-danger/40 text-danger px-3 py-2 text-xs font-semibold hover:bg-danger/30 transition disabled:opacity-50"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {revealed && (
        <CodeRevealModal
          code={revealed.code}
          email={revealed.email}
          expiresAt={revealed.expiresAt}
          onClose={() => setRevealed(null)}
        />
      )}
    </div>
  );
}
