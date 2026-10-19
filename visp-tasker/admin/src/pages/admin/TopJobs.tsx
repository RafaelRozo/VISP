import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminService, TopJobsData } from '@/services/adminService';

// Gold, the same accent the provider app uses for the Top Jobs card.
const GOLD = '#F5B700';

export default function TopJobs() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const q = useQuery<TopJobsData>({
    queryKey: ['top-jobs'],
    queryFn: () => adminService.getTopJobs(),
  });

  // Ordered list of task ids being edited. Starts as the saved list.
  const [draft, setDraft] = useState<string[]>([]);
  const [justSaved, setJustSaved] = useState(false);

  const savedIds = useMemo(() => (q.data?.selected ?? []).map((s) => s.id), [q.data]);
  useEffect(() => {
    setDraft(savedIds);
  }, [savedIds]);

  const names = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of q.data?.categories ?? []) for (const task of c.tasks) m[task.id] = task.name;
    return m;
  }, [q.data]);

  const dirty = draft.join(',') !== savedIds.join(',');
  const draftSet = new Set(draft);

  const save = useMutation({
    mutationFn: (ids: string[]) => adminService.saveTopJobs(ids),
    onSuccess: (data) => {
      qc.setQueryData(['top-jobs'], data);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    },
  });

  const toggle = (id: string) => {
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  };

  const move = (index: number, delta: number) => {
    setDraft((d) => {
      const next = [...d];
      const target = index + delta;
      if (target < 0 || target >= next.length) return d;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <span style={{ color: GOLD }}>★</span>
            {t('topJobs.title')}
          </h1>
          <p className="text-sm text-textSecondary mt-1 max-w-2xl">{t('topJobs.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-xs text-warning">{t('topJobs.unsaved')}</span>}
          {justSaved && !dirty && <span className="text-xs text-success">{t('topJobs.saved')}</span>}
          {dirty && (
            <button
              className="px-4 py-2 rounded-xl text-sm border border-glassBorder hover:bg-white/5"
              onClick={() => setDraft(savedIds)}
              disabled={save.isPending}
            >
              {t('topJobs.discard')}
            </button>
          )}
          <button
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-primary hover:bg-primaryDark disabled:opacity-40"
            onClick={() => save.mutate(draft)}
            disabled={!dirty || save.isPending}
          >
            {save.isPending ? t('topJobs.saving') : t('topJobs.save')}
          </button>
        </div>
      </div>

      {save.isError && <div className="glass p-3 text-sm text-danger">{t('topJobs.saveError')}</div>}

      {q.isLoading ? (
        <div className="glass p-8 text-textSecondary">…</div>
      ) : q.isError ? (
        <div className="glass p-8 text-danger">{t('topJobs.loadError')}</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(280px,380px)_1fr] items-start">
          {/* Current list, in app order */}
          <div className="glass p-5 space-y-3" style={{ borderColor: `${GOLD}66` }}>
            <div>
              <div className="font-bold" style={{ color: GOLD }}>
                {t('topJobs.current', { count: draft.length })}
              </div>
              <div className="text-xs text-textSecondary mt-1">{t('topJobs.currentHint')}</div>
            </div>
            {draft.length === 0 ? (
              <div className="text-sm text-textTertiary">{t('topJobs.empty')}</div>
            ) : (
              <ol className="space-y-1">
                {draft.map((id, i) => (
                  <li
                    key={id}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 bg-white/5 text-sm"
                  >
                    <span className="w-6 text-right text-textTertiary font-mono">{i + 1}</span>
                    <span className="flex-1">{names[id] ?? id}</span>
                    <button
                      className="px-1.5 text-textSecondary hover:text-textPrimary disabled:opacity-20"
                      title={t('topJobs.moveUp')}
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                    >
                      ↑
                    </button>
                    <button
                      className="px-1.5 text-textSecondary hover:text-textPrimary disabled:opacity-20"
                      title={t('topJobs.moveDown')}
                      onClick={() => move(i, 1)}
                      disabled={i === draft.length - 1}
                    >
                      ↓
                    </button>
                    <button
                      className="px-1.5 text-textSecondary hover:text-danger"
                      title={t('topJobs.remove')}
                      onClick={() => toggle(id)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* All active services, by category */}
          <div className="grid gap-4 md:grid-cols-2">
            {(q.data?.categories ?? []).map((c) => (
              <div key={c.id} className="glass p-4">
                <div className="font-semibold mb-2">{c.name}</div>
                <div className="space-y-1">
                  {c.tasks.map((task) => {
                    const checked = draftSet.has(task.id);
                    return (
                      <label
                        key={task.id}
                        className="flex items-center gap-2 text-sm cursor-pointer rounded-md px-1 py-0.5 hover:bg-white/5"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(task.id)}
                          style={{ accentColor: GOLD }}
                        />
                        <span className={checked ? 'font-semibold' : 'text-textSecondary'}>
                          {task.name}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
