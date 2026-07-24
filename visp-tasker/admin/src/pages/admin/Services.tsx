import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminService,
  CategoryUpsertBody,
  TaskUpsertBody,
  TaxonomyCategory,
} from '@/services/adminService';

type Level = '1' | '2' | '3' | '4';

interface CategoryFormState {
  id?: string;
  slug: string;
  name: string;
  description: string;
  displayOrder: number;
  isActive: boolean;
  // Section-based gating (migration 029).
  requiresCredential: boolean;
  helpMessageEn: string;
  helpMessageFr: string;
}

interface TaskFormState {
  id?: string;
  categoryId: string;
  slug: string;
  name: string;
  description: string;
  level: Level;
  regulated: boolean;
  licenseRequired: boolean;
  certificationRequired: boolean;
  hazardous: boolean;
  structural: boolean;
  emergencyEligible: boolean;
  basePriceMinCents: string;
  basePriceMaxCents: string;
  estimatedDurationMin: string;
  pricingUnit: string;
  allowsQuantity: boolean;
  minQuantity: string;
  displayOrder: number;
  isActive: boolean;
}

const emptyCategory: CategoryFormState = {
  slug: '',
  name: '',
  description: '',
  displayOrder: 0,
  isActive: true,
  requiresCredential: false,
  helpMessageEn: '',
  helpMessageFr: '',
};

const emptyTask = (categoryId: string): TaskFormState => ({
  categoryId,
  slug: '',
  name: '',
  description: '',
  level: '1',
  regulated: false,
  licenseRequired: false,
  certificationRequired: false,
  hazardous: false,
  structural: false,
  emergencyEligible: false,
  basePriceMinCents: '',
  basePriceMaxCents: '',
  estimatedDurationMin: '',
  pricingUnit: 'hourly',
  allowsQuantity: true,
  minQuantity: '1',
  displayOrder: 0,
  isActive: true,
});

function levelBadgeColor(level: Level): string {
  switch (level) {
    case '1': return 'var(--t-ok)';
    case '2': return '#F6AD55';
    case '3': return '#A78BFA';
    case '4': return 'var(--t-danger)';
  }
}

export default function Services() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [categoryForm, setCategoryForm] = useState<CategoryFormState | null>(null);
  const [taskForm, setTaskForm] = useState<TaskFormState | null>(null);

  const q = useQuery<TaxonomyCategory[]>({
    queryKey: ['taxonomy-full'],
    queryFn: () => adminService.taxonomyFull(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['taxonomy-full'] });

  const createCat = useMutation({
    mutationFn: (body: CategoryUpsertBody) => adminService.createCategory(body),
    onSuccess: () => { invalidate(); setCategoryForm(null); },
  });
  const updateCat = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<CategoryUpsertBody> }) =>
      adminService.updateCategory(id, body),
    onSuccess: () => { invalidate(); setCategoryForm(null); },
  });
  const deleteCat = useMutation({
    mutationFn: (id: string) => adminService.deleteCategory(id),
    onSuccess: invalidate,
  });

  const createTask = useMutation({
    mutationFn: (body: TaskUpsertBody) => adminService.createTask(body),
    onSuccess: () => { invalidate(); setTaskForm(null); },
  });
  const updateTask = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<TaskUpsertBody> }) =>
      adminService.updateTask(id, body),
    onSuccess: () => { invalidate(); setTaskForm(null); },
  });
  const deleteTask = useMutation({
    mutationFn: (id: string) => adminService.deleteTask(id),
    onSuccess: invalidate,
  });

  const categories = q.data ?? [];

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return categories;
    return categories
      .map((c) => {
        const catMatch = c.name.toLowerCase().includes(needle) || c.slug.toLowerCase().includes(needle);
        const filteredTasks = c.tasks.filter(
          (tk) =>
            tk.name.toLowerCase().includes(needle) ||
            tk.slug.toLowerCase().includes(needle) ||
            (tk.description && tk.description.toLowerCase().includes(needle)),
        );
        if (catMatch || filteredTasks.length > 0) {
          return { ...c, tasks: catMatch ? c.tasks : filteredTasks };
        }
        return null;
      })
      .filter((c): c is TaxonomyCategory => c !== null);
  }, [categories, search]);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="t-section-head" style={{ marginBottom: 0 }}>
        <span className="t-eyebrow">§ Catalog</span>
        <h1 className="t-h1" style={{ marginTop: 8 }}>{t('services.title')}</h1>
        <p className="t-lede" style={{ marginTop: 8 }}>{t('services.subtitle')}</p>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="t-search" style={{ flex: 1, minWidth: 280 }}>
          <SearchIcon />
          <input
            type="search"
            placeholder={t('services.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="t-btn t-btn-secondary"
          onClick={() => setCategoryForm({ ...emptyCategory })}
        >
          + {t('services.newCategory')}
        </button>
      </div>

      {q.isLoading && <div className="t-meta">{t('common.loading')}</div>}

      {!q.isLoading && filtered.length === 0 && (
        <div className="t-empty">
          <h3>{t('services.emptyAll')}</h3>
          <p>{search ? `"${search}"` : t('services.subtitle')}</p>
        </div>
      )}

      {/* Categories */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {filtered.map((cat) => {
          const isCollapsed = collapsed.has(cat.id);
          return (
            <div key={cat.id} className="t-card-base" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Category header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 20px',
                  borderBottom: isCollapsed ? 'none' : '1px solid var(--t-border)',
                  background: 'var(--t-surface)',
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleCollapse(cat.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, textAlign: 'left' }}
                >
                  <span
                    style={{
                      width: 20, height: 20, display: 'grid', placeItems: 'center',
                      color: 'var(--t-text-3)', transition: 'transform .15s',
                      transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10"><polyline points="1,3 5,7 9,3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--t-text)', letterSpacing: '-0.01em' }}>
                      {cat.name}
                    </div>
                    <div className="t-mono" style={{ fontSize: 11, color: 'var(--t-text-3)', marginTop: 2, letterSpacing: '0.08em' }}>
                      {cat.slug} · {cat.tasks.length} {cat.tasks.length === 1 ? t('services.tasksInCategory') : t('services.tasksInCategoryPlural')}
                      {!cat.isActive && <span style={{ marginLeft: 8, color: 'var(--t-warn)' }}>· inactive</span>}
                    </div>
                  </div>
                </button>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    type="button"
                    className="t-btn t-btn-secondary t-btn-sm"
                    onClick={() => setTaskForm(emptyTask(cat.id))}
                  >
                    + {t('services.newTask')}
                  </button>
                  <button
                    type="button"
                    className="t-btn t-btn-ghost t-btn-sm"
                    onClick={() => setCategoryForm({
                      id: cat.id,
                      slug: cat.slug,
                      name: cat.name,
                      description: cat.description ?? '',
                      displayOrder: cat.displayOrder,
                      isActive: cat.isActive,
                      requiresCredential: cat.requiresCredential ?? false,
                      helpMessageEn: cat.helpMessageEn ?? '',
                      helpMessageFr: cat.helpMessageFr ?? '',
                    })}
                  >
                    {t('common.edit')}
                  </button>
                  <button
                    type="button"
                    className="t-btn t-btn-ghost t-btn-sm"
                    style={{ color: 'var(--t-danger)' }}
                    onClick={() => {
                      if (confirm(t('services.deleteCategoryConfirm'))) {
                        deleteCat.mutate(cat.id);
                      }
                    }}
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </div>

              {/* Task list */}
              {!isCollapsed && (
                <div>
                  {cat.tasks.length === 0 ? (
                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--t-text-3)', fontSize: 13 }}>
                      {t('services.emptyCategory')}
                    </div>
                  ) : (
                    cat.tasks.map((tk, idx) => (
                      <div
                        key={tk.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 14,
                          padding: '14px 20px',
                          borderTop: idx === 0 ? 'none' : '1px solid var(--t-border)',
                        }}
                      >
                        <span className="t-mono" style={{ fontSize: 10, color: 'var(--t-text-4)', letterSpacing: '0.1em', width: 24 }}>
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t-text)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span>{tk.name}</span>
                            <span className="t-chip t-chip-mono" style={{ color: levelBadgeColor(tk.level), borderColor: levelBadgeColor(tk.level) }}>
                              L{tk.level}
                            </span>
                            {tk.emergencyEligible && <span className="t-chip t-chip-mono t-chip-danger">EMERG</span>}
                            {tk.licenseRequired && <span className="t-chip t-chip-mono">LIC</span>}
                            {tk.regulated && <span className="t-chip t-chip-mono">REG</span>}
                            {!tk.isActive && <span className="t-chip t-chip-mono t-chip-warn">INACTIVE</span>}
                          </div>
                          <div className="t-mono" style={{ fontSize: 11, color: 'var(--t-text-3)', marginTop: 3, letterSpacing: '0.06em' }}>
                            {tk.slug}
                            {tk.basePriceMinCents != null && tk.basePriceMaxCents != null && (
                              <> · ${(tk.basePriceMinCents / 100).toFixed(0)}–${(tk.basePriceMaxCents / 100).toFixed(0)}</>
                            )}
                            {tk.estimatedDurationMin != null && <> · {tk.estimatedDurationMin} min</>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            type="button"
                            className="t-btn t-btn-ghost t-btn-sm"
                            onClick={() => setTaskForm({
                              id: tk.id,
                              categoryId: tk.categoryId,
                              slug: tk.slug,
                              name: tk.name,
                              description: tk.description ?? '',
                              level: tk.level,
                              regulated: tk.regulated,
                              licenseRequired: tk.licenseRequired,
                              certificationRequired: tk.certificationRequired,
                              hazardous: tk.hazardous,
                              structural: tk.structural,
                              emergencyEligible: tk.emergencyEligible,
                              basePriceMinCents: tk.basePriceMinCents != null ? String(tk.basePriceMinCents) : '',
                              basePriceMaxCents: tk.basePriceMaxCents != null ? String(tk.basePriceMaxCents) : '',
                              estimatedDurationMin: tk.estimatedDurationMin != null ? String(tk.estimatedDurationMin) : '',
                              pricingUnit: tk.pricingUnit ?? 'hourly',
                              allowsQuantity: tk.allowsQuantity ?? true,
                              minQuantity: tk.minQuantity != null ? String(tk.minQuantity) : '1',
                              displayOrder: tk.displayOrder,
                              isActive: tk.isActive,
                            })}
                          >
                            {t('common.edit')}
                          </button>
                          <button
                            type="button"
                            className="t-btn t-btn-ghost t-btn-sm"
                            style={{ color: 'var(--t-danger)' }}
                            onClick={() => {
                              if (confirm(t('services.deleteTaskConfirm'))) {
                                deleteTask.mutate(tk.id);
                              }
                            }}
                          >
                            {t('common.delete')}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Category modal */}
      {categoryForm && (
        <CategoryModal
          form={categoryForm}
          onClose={() => setCategoryForm(null)}
          onSubmit={(body) => {
            if (categoryForm.id) {
              updateCat.mutate({ id: categoryForm.id, body });
            } else {
              createCat.mutate(body);
            }
          }}
          submitting={createCat.isPending || updateCat.isPending}
        />
      )}

      {/* Task modal */}
      {taskForm && (
        <TaskModal
          form={taskForm}
          categories={categories}
          onClose={() => setTaskForm(null)}
          onSubmit={(body) => {
            if (taskForm.id) {
              updateTask.mutate({ id: taskForm.id, body });
            } else {
              createTask.mutate(body);
            }
          }}
          submitting={createTask.isPending || updateTask.isPending}
        />
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/* =================== Category modal =================== */
function CategoryModal({
  form,
  onClose,
  onSubmit,
  submitting,
}: {
  form: CategoryFormState;
  onClose: () => void;
  onSubmit: (body: CategoryUpsertBody) => void;
  submitting: boolean;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<CategoryFormState>(form);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      slug: state.slug.trim(),
      name: state.name.trim(),
      description: state.description.trim() || null,
      displayOrder: state.displayOrder,
      isActive: state.isActive,
      requiresCredential: state.requiresCredential,
      helpMessageEn: state.helpMessageEn.trim() || null,
      helpMessageFr: state.helpMessageFr.trim() || null,
    });
  };

  return (
    <div className="t-modal-backdrop" onClick={onClose}>
      <form className="t-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="t-modal-head">
          <div>
            <span className="t-eyebrow">§ {form.id ? 'Edit' : 'New'}</span>
            <div className="t-h3" style={{ marginTop: 4 }}>
              {form.id ? t('services.editCategory') : t('services.newCategory')}
            </div>
          </div>
          <button type="button" onClick={onClose} className="t-btn t-btn-ghost t-btn-sm">✕</button>
        </div>
        <div className="t-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="t-label">{t('services.categoryName')}</label>
            <input type="text" className="t-input" required value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })} />
          </div>
          <div>
            <label className="t-label">{t('services.categorySlug')}</label>
            <input type="text" className="t-input" required pattern="[a-z0-9-]+" value={state.slug} onChange={(e) => setState({ ...state, slug: e.target.value })} />
          </div>
          <div>
            <label className="t-label">{t('services.categoryDescription')}</label>
            <textarea className="t-textarea" value={state.description} onChange={(e) => setState({ ...state, description: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            <div style={{ flex: 1 }}>
              <label className="t-label">{t('services.displayOrder')}</label>
              <input type="number" className="t-input" value={state.displayOrder} onChange={(e) => setState({ ...state, displayOrder: parseInt(e.target.value || '0', 10) })} />
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--t-text-2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={state.isActive} onChange={(e) => setState({ ...state, isActive: e.target.checked })} />
                {t('services.isActive')}
              </label>
            </div>
          </div>

          {/* Section-based gating (migration 029) */}
          <div style={{ borderTop: '1px solid var(--t-border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, color: 'var(--t-text-1)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={state.requiresCredential}
                onChange={(e) => setState({ ...state, requiresCredential: e.target.checked })}
                style={{ marginTop: 3 }}
              />
              <span>
                <strong>{t('services.requiresCredential')}</strong>
                <div style={{ fontSize: 12, color: 'var(--t-text-2)', marginTop: 2 }}>
                  {t('services.requiresCredentialHint')}
                </div>
              </span>
            </label>

            {state.requiresCredential && (
              <>
                <div>
                  <label className="t-label">{t('services.helpMessageEn')}</label>
                  <textarea
                    className="t-textarea"
                    placeholder="e.g. Upload a valid Ontario municipal plumber licence (e.g. G-185237)."
                    value={state.helpMessageEn}
                    onChange={(e) => setState({ ...state, helpMessageEn: e.target.value })}
                  />
                </div>
                <div>
                  <label className="t-label">{t('services.helpMessageFr')}</label>
                  <textarea
                    className="t-textarea"
                    placeholder="ex. Téléversez un permis de plombier municipal valide de l'Ontario (ex. G-185237)."
                    value={state.helpMessageFr}
                    onChange={(e) => setState({ ...state, helpMessageFr: e.target.value })}
                  />
                </div>
              </>
            )}
          </div>
        </div>
        <div className="t-modal-foot">
          <button type="button" className="t-btn t-btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="t-btn t-btn-primary" disabled={submitting}>
            {submitting && <span className="t-spinner" />}
            {form.id ? t('common.save') : t('common.create')}
          </button>
        </div>
      </form>
    </div>
  );
}

/* =================== Task modal =================== */
function TaskModal({
  form,
  categories,
  onClose,
  onSubmit,
  submitting,
}: {
  form: TaskFormState;
  categories: TaxonomyCategory[];
  onClose: () => void;
  onSubmit: (body: TaskUpsertBody) => void;
  submitting: boolean;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<TaskFormState>(form);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      categoryId: state.categoryId,
      slug: state.slug.trim(),
      name: state.name.trim(),
      description: state.description.trim() || null,
      level: state.level,
      regulated: state.regulated,
      licenseRequired: state.licenseRequired,
      certificationRequired: state.certificationRequired,
      hazardous: state.hazardous,
      structural: state.structural,
      emergencyEligible: state.emergencyEligible,
      basePriceMinCents: state.basePriceMinCents.trim() === '' ? null : parseInt(state.basePriceMinCents, 10),
      basePriceMaxCents: state.basePriceMaxCents.trim() === '' ? null : parseInt(state.basePriceMaxCents, 10),
      estimatedDurationMin: state.estimatedDurationMin.trim() === '' ? null : parseInt(state.estimatedDurationMin, 10),
      pricingUnit: state.pricingUnit,
      allowsQuantity: state.allowsQuantity,
      minQuantity: state.minQuantity.trim() === '' ? null : parseFloat(state.minQuantity),
      displayOrder: state.displayOrder,
      isActive: state.isActive,
    });
  };

  return (
    <div className="t-modal-backdrop" onClick={onClose}>
      <form
        className="t-modal"
        style={{ maxWidth: 640 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="t-modal-head">
          <div>
            <span className="t-eyebrow">§ {form.id ? 'Edit' : 'New'}</span>
            <div className="t-h3" style={{ marginTop: 4 }}>
              {form.id ? t('services.editTask') : t('services.newTask')}
            </div>
          </div>
          <button type="button" onClick={onClose} className="t-btn t-btn-ghost t-btn-sm">✕</button>
        </div>

        <div className="t-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="t-label">{t('filters.category')}</label>
            <select className="t-select" style={{ width: '100%' }} value={state.categoryId} onChange={(e) => setState({ ...state, categoryId: e.target.value })}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
            <div>
              <label className="t-label">{t('services.taskName')}</label>
              <input type="text" className="t-input" required value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })} />
            </div>
            <div>
              <label className="t-label">{t('services.level')}</label>
              <select className="t-select" style={{ width: '100%' }} value={state.level} onChange={(e) => setState({ ...state, level: e.target.value as Level })}>
                <option value="1">L1 — Helper</option>
                <option value="2">L2 — Experienced</option>
                <option value="3">L3 — Certified Pro</option>
                <option value="4">L4 — Emergency</option>
              </select>
            </div>
          </div>

          <div>
            <label className="t-label">{t('services.taskSlug')}</label>
            <input type="text" className="t-input" required pattern="[a-z0-9-]+" value={state.slug} onChange={(e) => setState({ ...state, slug: e.target.value })} />
          </div>

          <div>
            <label className="t-label">{t('services.taskDescription')}</label>
            <textarea className="t-textarea" value={state.description} onChange={(e) => setState({ ...state, description: e.target.value })} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label className="t-label">{t('services.basePriceMin')}</label>
              <input type="number" className="t-input" value={state.basePriceMinCents} onChange={(e) => setState({ ...state, basePriceMinCents: e.target.value })} />
            </div>
            <div>
              <label className="t-label">{t('services.basePriceMax')}</label>
              <input type="number" className="t-input" value={state.basePriceMaxCents} onChange={(e) => setState({ ...state, basePriceMaxCents: e.target.value })} />
            </div>
            <div>
              <label className="t-label">{t('services.estDuration')}</label>
              <input type="number" className="t-input" value={state.estimatedDurationMin} onChange={(e) => setState({ ...state, estimatedDurationMin: e.target.value })} />
            </div>
          </div>

          {/* Charge unit + quantity (provider-set pricing) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 10 }}>
            <div>
              <label className="t-label">{t('services.chargeUnit') || 'Charge unit'}</label>
              <select
                className="t-select"
                style={{ width: '100%' }}
                value={state.pricingUnit}
                onChange={(e) => setState({ ...state, pricingUnit: e.target.value })}
              >
                <option value="hourly">Hourly (per hour)</option>
                <option value="per_unit">Per unit / item</option>
                <option value="per_area">Per area (m²)</option>
                <option value="per_linear_m">Per linear meter (ml)</option>
                <option value="per_visit">Per visit (flat)</option>
                <option value="flat_package">Flat package</option>
                <option value="custom_quote">Custom quote</option>
              </select>
            </div>
            <div>
              <label className="t-label">{t('services.minQuantity') || 'Min quantity'}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="t-input"
                value={state.minQuantity}
                onChange={(e) => setState({ ...state, minQuantity: e.target.value })}
              />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--t-text-2)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={state.allowsQuantity}
              onChange={(e) => setState({ ...state, allowsQuantity: e.target.checked })}
            />
            {t('services.allowsQuantity') || 'Customer can choose quantity (e.g. 3 items, 25 m²)'}
          </label>

          {/* Flags — collapsed by default. Credential gating now lives at the
              section level (category.requiresCredential); these per-task flags
              stay available only for the rare service that needs a specific
              document/attribute beyond its section. */}
          <details style={{ border: '1px solid var(--t-border)', borderRadius: 8, background: 'var(--t-deep)' }}>
            <summary style={{ padding: '12px 14px', fontSize: 13, color: 'var(--t-text-2)', cursor: 'pointer', userSelect: 'none' }}>
              {t('services.specialFlags') || 'Special requirements / documents (optional)'}
            </summary>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '0 14px 14px' }}>
              {([
                ['regulated', t('services.regulated')],
                ['licenseRequired', t('services.licenseRequired')],
                ['certificationRequired', t('services.certRequired')],
                ['hazardous', t('services.hazardous')],
                ['structural', t('services.structural')],
                ['emergencyEligible', t('services.emergencyEligible')],
              ] as const).map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--t-text-2)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={(state as any)[key]}
                    onChange={(e) => setState({ ...state, [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
          </details>

          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label className="t-label">{t('services.displayOrder')}</label>
              <input type="number" className="t-input" value={state.displayOrder} onChange={(e) => setState({ ...state, displayOrder: parseInt(e.target.value || '0', 10) })} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--t-text-2)', cursor: 'pointer', height: 44 }}>
              <input type="checkbox" checked={state.isActive} onChange={(e) => setState({ ...state, isActive: e.target.checked })} />
              {t('services.isActive')}
            </label>
          </div>
        </div>

        <div className="t-modal-foot">
          <button type="button" className="t-btn t-btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="t-btn t-btn-primary" disabled={submitting}>
            {submitting && <span className="t-spinner" />}
            {form.id ? t('common.save') : t('common.create')}
          </button>
        </div>
      </form>
    </div>
  );
}
