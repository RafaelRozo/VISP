import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminService,
  CategoryUpsertBody,
  CREDENTIAL_GATED_LEVELS,
  CredentialRequirementKind,
  CredentialRequirementOption,
  CredentialRequirementUpsertBody,
  levelColor,
  REQUIREMENT_KIND_ORDER,
  SERVICE_LEVELS,
  ServiceLevel,
  TaskCredentialRequirement,
  TaskQuestion,
  TaskUpsertBody,
  TaxonomyCategory,
  VERIFICATION_METHODS,
  VerificationMethod,
} from '@/services/adminService';
import { centsToInput, formatMoneyRange, inputToCents } from '@/lib/money';

type Level = ServiceLevel;

interface CategoryFormState {
  id?: string;
  slug: string;
  name: string;
  description: string;
  displayOrder: number;
  isActive: boolean;
  // Ayuda bilingüe. Antes describía el documento de la sección (migración 029);
  // ahora que el gate es por servicio, se reutiliza como ayuda para la evidencia
  // de experiencia que el proveedor sube por clasificación (L1).
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
  credentialRequirements: TaskCredentialRequirement[];
  regulated: boolean;
  licenseRequired: boolean;
  certificationRequired: boolean;
  hazardous: boolean;
  structural: boolean;
  emergencyEligible: boolean;
  /** En DÓLARES en el formulario; se convierte a centavos al guardar. */
  basePriceMin: string;
  basePriceMax: string;
  estimatedDurationMin: string;
  pricingUnit: string;
  allowsQuantity: boolean;
  minQuantity: string;
  /**
   * Requisitos de ENTRADA DE LA RESERVA (migración 038). Lo que debe aportar el
   * CLIENTE al reservar, no lo que debe tener el proveedor.
   */
  requiresDetails: boolean;
  requiresEvidence: boolean;
  detailsPromptEn: string;
  detailsPromptFr: string;
  /** Requisito CGL del servicio: lo debe tener el PROVEEDOR, no el cliente. */
  requiresInsurance: boolean;
  /**
   * Materiales: el proveedor los compra y el cliente se los reembolsa. El rango
   * (en DÓLARES en el formulario) acota lo que el cliente puede autorizar; la nota
   * es el mensaje para el PROVEEDOR, que la lee antes de ofertar.
   */
  materialsEnabled: boolean;
  materialsBudgetMin: string;
  materialsBudgetMax: string;
  materialsNoteEn: string;
  materialsNoteFr: string;
  questions: TaskQuestion[];
  displayOrder: number;
  isActive: boolean;
}

const emptyCategory: CategoryFormState = {
  slug: '',
  name: '',
  description: '',
  displayOrder: 0,
  isActive: true,
  helpMessageEn: '',
  helpMessageFr: '',
};

interface RequirementFormState {
  /** Vacío = alta. Con valor = edición (el código es la PK, no se cambia). */
  originalCode?: string;
  code: string;
  labelEn: string;
  labelFr: string;
  kind: CredentialRequirementKind;
  authority: string;
  registryName: string;
  registryUrl: string;
  verificationMethod: VerificationMethod;
  description: string;
  isActive: boolean;
}

const emptyRequirement: RequirementFormState = {
  code: '',
  labelEn: '',
  labelFr: '',
  kind: 'CREDENTIAL',
  authority: '',
  registryName: '',
  registryUrl: '',
  verificationMethod: 'DOCUMENT',
  description: '',
  isActive: true,
};

const emptyTask = (categoryId: string): TaskFormState => ({
  categoryId,
  slug: '',
  name: '',
  description: '',
  level: '0',
  credentialRequirements: [],
  regulated: false,
  licenseRequired: false,
  certificationRequired: false,
  hazardous: false,
  structural: false,
  emergencyEligible: false,
  basePriceMin: '',
  basePriceMax: '',
  estimatedDurationMin: '',
  pricingUnit: 'hourly',
  allowsQuantity: true,
  minQuantity: '1',
  requiresDetails: false,
  requiresEvidence: false,
  detailsPromptEn: '',
  detailsPromptFr: '',
  requiresInsurance: false,
  materialsEnabled: false,
  materialsBudgetMin: '',
  materialsBudgetMax: '',
  materialsNoteEn: '',
  materialsNoteFr: '',
  questions: [],
  displayOrder: 0,
  isActive: true,
});

export default function Services() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<Level | 'all'>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [categoryForm, setCategoryForm] = useState<CategoryFormState | null>(null);
  const [taskForm, setTaskForm] = useState<TaskFormState | null>(null);
  // Gestor del catálogo de requisitos: lista + editor de una ficha.
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [requirementForm, setRequirementForm] = useState<RequirementFormState | null>(null);

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
    return categories
      .map((c) => {
        const catMatch =
          !needle ||
          c.name.toLowerCase().includes(needle) ||
          c.slug.toLowerCase().includes(needle);
        // La búsqueda por texto encaja con la categoría entera; el filtro por
        // nivel siempre se aplica a los servicios, uno a uno.
        const tasks = (catMatch ? c.tasks : c.tasks.filter(
          (tk) =>
            tk.name.toLowerCase().includes(needle) ||
            tk.slug.toLowerCase().includes(needle) ||
            (tk.description && tk.description.toLowerCase().includes(needle)),
        )).filter((tk) => levelFilter === 'all' || tk.level === levelFilter);

        if (tasks.length > 0 || (catMatch && levelFilter === 'all')) {
          // El backend ya ordena por nivel; reordenamos por si acaso para que
          // los separadores de nivel salgan siempre bien.
          const sorted = [...tasks].sort(
            (a, b) => a.level.localeCompare(b.level) || a.name.localeCompare(b.name),
          );
          return { ...c, tasks: sorted };
        }
        return null;
      })
      .filter((c): c is TaxonomyCategory => c !== null);
  }, [categories, search, levelFilter]);

  /** Cuántos servicios activos hay por nivel — el resumen que el cliente revisa. */
  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0 };
    for (const c of categories) {
      for (const tk of c.tasks) {
        counts[tk.level] = (counts[tk.level] ?? 0) + 1;
        counts.all += 1;
      }
    }
    return counts;
  }, [categories]);

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
          className="t-btn t-btn-ghost"
          onClick={() => setCatalogOpen(true)}
          title={t('services.manageRequirementsHint')}
        >
          {t('services.manageRequirements')}
        </button>
        <button
          type="button"
          className="t-btn t-btn-secondary"
          onClick={() => setCategoryForm({ ...emptyCategory })}
        >
          + {t('services.newCategory')}
        </button>
      </div>

      {/* Filtro por nivel — la vista principal de revisión del catálogo L0–L3 */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className={`t-chip${levelFilter === 'all' ? ' t-chip-active' : ''}`}
          style={{
            cursor: 'pointer',
            borderColor: levelFilter === 'all' ? 'var(--t-text)' : undefined,
            color: levelFilter === 'all' ? 'var(--t-text)' : undefined,
          }}
          onClick={() => setLevelFilter('all')}
        >
          {t('services.allLevels')} · {levelCounts.all ?? 0}
        </button>
        {SERVICE_LEVELS.map((lv) => (
          <button
            key={lv.value}
            type="button"
            className="t-chip t-chip-mono"
            style={{
              cursor: 'pointer',
              color: lv.color,
              borderColor: lv.color,
              opacity: levelFilter === 'all' || levelFilter === lv.value ? 1 : 0.4,
            }}
            onClick={() => setLevelFilter(levelFilter === lv.value ? 'all' : lv.value)}
            title={lv.label}
          >
            L{lv.value} · {levelCounts[lv.value] ?? 0}
          </button>
        ))}
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
                    cat.tasks.map((tk, idx) => {
                      const prevLevel = idx > 0 ? cat.tasks[idx - 1].level : null;
                      const startsLevel = tk.level !== prevLevel;
                      const color = levelColor(tk.level);
                      const price = formatMoneyRange(tk.basePriceMinCents, tk.basePriceMaxCents);
                      const needsCreds = CREDENTIAL_GATED_LEVELS.includes(tk.level);
                      const reqs = tk.credentialRequirements ?? [];
                      return (
                      <div key={tk.id}>
                        {/* Separador de nivel: el catálogo se lee L0 -> L3 */}
                        {startsLevel && (
                          <div
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '10px 20px 6px',
                              borderTop: idx === 0 ? 'none' : '1px solid var(--t-border)',
                              background: 'var(--t-deep)',
                            }}
                          >
                            <span className="t-chip t-chip-mono" style={{ color, borderColor: color }}>
                              L{tk.level}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--t-text-3)', letterSpacing: '0.04em' }}>
                              {SERVICE_LEVELS.find((l) => l.value === tk.level)?.label}
                            </span>
                          </div>
                        )}
                      <div
                        style={{
                          display: 'flex', alignItems: 'center', gap: 14,
                          padding: '14px 20px',
                          borderTop: startsLevel ? 'none' : '1px solid var(--t-border)',
                        }}
                      >
                        <span className="t-mono" style={{ fontSize: 10, color: 'var(--t-text-4)', letterSpacing: '0.1em', width: 24 }}>
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t-text)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span>{tk.name}</span>
                            <span className="t-chip t-chip-mono" style={{ color, borderColor: color }}>
                              L{tk.level}
                            </span>
                            {/* Un L2/L3 sin requisitos no lo puede tomar nadie. */}
                            {needsCreds && reqs.length === 0 && (
                              <span className="t-chip t-chip-mono t-chip-warn" title={t('services.noCredsWarning')}>
                                ⚠ {t('services.noCreds')}
                              </span>
                            )}
                            {reqs.map((r) => (
                              <span
                                key={r.code}
                                className="t-chip t-chip-mono"
                                title={`${r.labelEn ?? r.code}${r.mandatory ? '' : ' — ' + t('services.conditional')}`}
                                style={{ opacity: r.mandatory ? 1 : 0.55 }}
                              >
                                {r.code}{r.mandatory ? '' : '?'}
                              </span>
                            ))}
                            {/* Lo que se le exige al CLIENTE al reservar. Se muestra
                                aquí para poder auditar de un vistazo qué servicios
                                lo piden, sin abrir cada modal. */}
                            {tk.requiresDetails && (
                              <span className="t-chip t-chip-mono" title={t('services.requiresDetails')}>
                                {t('services.detailsChip')}
                              </span>
                            )}
                            {tk.requiresEvidence && (
                              <span className="t-chip t-chip-mono" title={t('services.requiresEvidence')}>
                                {t('services.evidenceChip')}
                              </span>
                            )}
                            {!tk.isActive && <span className="t-chip t-chip-mono t-chip-warn">INACTIVE</span>}
                          </div>
                          <div className="t-mono" style={{ fontSize: 11, color: 'var(--t-text-3)', marginTop: 3, letterSpacing: '0.06em' }}>
                            {tk.slug}
                            {price && <> · {price}</>}
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
                              credentialRequirements: reqs,
                              regulated: tk.regulated,
                              licenseRequired: tk.licenseRequired,
                              certificationRequired: tk.certificationRequired,
                              hazardous: tk.hazardous,
                              structural: tk.structural,
                              emergencyEligible: tk.emergencyEligible,
                              basePriceMin: centsToInput(tk.basePriceMinCents),
                              basePriceMax: centsToInput(tk.basePriceMaxCents),
                              estimatedDurationMin: tk.estimatedDurationMin != null ? String(tk.estimatedDurationMin) : '',
                              pricingUnit: tk.pricingUnit ?? 'hourly',
                              allowsQuantity: tk.allowsQuantity ?? true,
                              minQuantity: tk.minQuantity != null ? String(tk.minQuantity) : '1',
                              requiresDetails: tk.requiresDetails ?? false,
                              requiresEvidence: tk.requiresEvidence ?? false,
                              detailsPromptEn: tk.detailsPromptEn ?? '',
                              detailsPromptFr: tk.detailsPromptFr ?? '',
                              requiresInsurance: tk.requiresInsurance ?? false,
                              materialsEnabled: tk.materialsEnabled ?? false,
                              materialsBudgetMin: centsToInput(tk.materialsBudgetMinCents),
                              materialsBudgetMax: centsToInput(tk.materialsBudgetMaxCents),
                              materialsNoteEn: tk.materialsNoteEn ?? '',
                              materialsNoteFr: tk.materialsNoteFr ?? '',
                              questions: (tk.questions ?? []).map((q) => ({
                                ...q,
                                options: q.options ?? [],
                                materialsOnly: q.materialsOnly ?? false,
                              })),
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
                      </div>
                      );
                    })
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
          errorMessage={
            // El backend rechaza con 400 un L2/L3 sin requisitos de credencial.
            ((createTask.error ?? updateTask.error) as { message?: string } | null)?.message ?? null
          }
        />
      )}

      {/* Modal 1 — catálogo de requisitos (lista + alta/edición/baja) */}
      {catalogOpen && (
        <RequirementCatalogModal
          onClose={() => setCatalogOpen(false)}
          onNew={() => setRequirementForm({ ...emptyRequirement })}
          onEdit={(o) => setRequirementForm({
            originalCode: o.code,
            code: o.code,
            labelEn: o.labelEn,
            labelFr: o.labelFr ?? '',
            kind: o.kind,
            authority: o.authority ?? '',
            registryName: o.registryName ?? '',
            registryUrl: o.registryUrl ?? '',
            verificationMethod: o.verificationMethod,
            description: o.description ?? '',
            isActive: o.isActive ?? true,
          })}
        />
      )}

      {/* Modal 2 — ficha de un requisito */}
      {requirementForm && (
        <RequirementEditModal
          form={requirementForm}
          onClose={() => setRequirementForm(null)}
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

          {/* Ayuda para la evidencia de experiencia L1.
              El gate por SECCIÓN de la migración 029 desapareció: ahora la
              credencial se exige por servicio. Estos textos se reutilizan como
              la ayuda que ve el proveedor al subir su experiencia en esta
              clasificación para desbloquear los servicios L1. */}
          <div style={{ borderTop: '1px solid var(--t-border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <strong style={{ fontSize: 14, color: 'var(--t-text-1)' }}>
                {t('services.experienceHelpTitle')}
              </strong>
              <div style={{ fontSize: 12, color: 'var(--t-text-2)', marginTop: 2 }}>
                {t('services.experienceHelpHint')}
              </div>
            </div>
            <div>
              <label className="t-label">{t('services.helpMessageEn')}</label>
              <textarea
                className="t-textarea"
                placeholder="e.g. Upload a resume, references, training records or photos of similar work you have done."
                value={state.helpMessageEn}
                onChange={(e) => setState({ ...state, helpMessageEn: e.target.value })}
              />
            </div>
            <div>
              <label className="t-label">{t('services.helpMessageFr')}</label>
              <textarea
                className="t-textarea"
                placeholder="ex. Téléversez un CV, des références, des attestations de formation ou des photos de travaux similaires."
                value={state.helpMessageFr}
                onChange={(e) => setState({ ...state, helpMessageFr: e.target.value })}
              />
            </div>
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
  errorMessage,
}: {
  form: TaskFormState;
  categories: TaxonomyCategory[];
  onClose: () => void;
  onSubmit: (body: TaskUpsertBody) => void;
  submitting: boolean;
  errorMessage: string | null;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<TaskFormState>(form);

  const options = useQuery<CredentialRequirementOption[]>({
    queryKey: ['credential-requirement-options'],
    queryFn: () => adminService.credentialRequirementOptions(),
    staleTime: 5 * 60 * 1000,
  });

  const needsCreds = CREDENTIAL_GATED_LEVELS.includes(state.level);
  const credGateFails = needsCreds && state.credentialRequirements.length === 0;

  // Espeja el 400 de la API: detalles obligatorios exigen prompt EN. El prompt es
  // lo que mantiene el texto libre dentro de la regla del catálogo cerrado —
  // orienta a describir escala y acceso del servicio elegido en vez de pedir
  // trabajo extra. Mejor bloquearlo aquí que dejar que el guardado falle.
  const detailsPromptMissing =
    state.requiresDetails && state.detailsPromptEn.trim() === '';

  // Espeja el 400 de la API: una pregunta cerrada necesita al menos DOS opciones
  // distintas. Con menos, el cliente no puede contestarla y la reserva queda
  // bloqueada sin que él pueda hacer nada — mejor no dejar guardar.
  const questionOptionsInvalid = state.questions.some(
    (q) =>
      q.questionEn.trim() !== '' &&
      q.answerType === 'SINGLE_CHOICE' &&
      new Set(
        (q.options ?? []).map((o) => o.en.trim()).filter((v) => v !== ''),
      ).size < 2,
  );

  const addRequirement = (code: string) => {
    if (!code || state.credentialRequirements.some((r) => r.code === code)) return;
    setState({
      ...state,
      credentialRequirements: [...state.credentialRequirements, { code, mandatory: true }],
    });
  };

  const removeRequirement = (code: string) =>
    setState({
      ...state,
      credentialRequirements: state.credentialRequirements.filter((r) => r.code !== code),
    });

  const toggleMandatory = (code: string) =>
    setState({
      ...state,
      credentialRequirements: state.credentialRequirements.map((r) =>
        r.code === code ? { ...r, mandatory: !r.mandatory } : r,
      ),
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (credGateFails || detailsPromptMissing || questionOptionsInvalid) return;
    onSubmit({
      categoryId: state.categoryId,
      slug: state.slug.trim(),
      name: state.name.trim(),
      description: state.description.trim() || null,
      level: state.level,
      credentialRequirements: state.credentialRequirements.map((r) => ({
        code: r.code,
        mandatory: r.mandatory,
        notes: r.notes ?? null,
      })),
      regulated: state.regulated,
      licenseRequired: state.licenseRequired,
      certificationRequired: state.certificationRequired,
      hazardous: state.hazardous,
      structural: state.structural,
      emergencyEligible: state.emergencyEligible,
      // Los inputs están en dólares; la API siempre habla en centavos.
      basePriceMinCents: inputToCents(state.basePriceMin),
      basePriceMaxCents: inputToCents(state.basePriceMax),
      estimatedDurationMin: state.estimatedDurationMin.trim() === '' ? null : parseInt(state.estimatedDurationMin, 10),
      pricingUnit: state.pricingUnit,
      allowsQuantity: state.allowsQuantity,
      minQuantity: state.minQuantity.trim() === '' ? null : parseFloat(state.minQuantity),
      requiresDetails: state.requiresDetails,
      requiresEvidence: state.requiresEvidence,
      detailsPromptEn: state.detailsPromptEn.trim() || null,
      detailsPromptFr: state.detailsPromptFr.trim() || null,
      requiresInsurance: state.requiresInsurance,
      materialsEnabled: state.materialsEnabled,
      // Solo se mandan si el material está activo: un rango olvidado de una vez que
      // se probó el checkbox no debe quedar guardado en un servicio sin material.
      materialsBudgetMinCents: state.materialsEnabled ? inputToCents(state.materialsBudgetMin) : null,
      materialsBudgetMaxCents: state.materialsEnabled ? inputToCents(state.materialsBudgetMax) : null,
      materialsNoteEn: state.materialsEnabled ? state.materialsNoteEn.trim() || null : null,
      materialsNoteFr: state.materialsEnabled ? state.materialsNoteFr.trim() || null : null,
      // Se descartan las preguntas sin texto: una fila vacía olvidada en el
      // formulario crearía una pregunta imposible de responder.
      questions: state.questions
        .filter((q) => q.questionEn.trim() !== '')
        .map((q, i) => ({
          ...q,
          questionEn: q.questionEn.trim(),
          questionFr: q.questionFr?.trim() || null,
          displayOrder: i,
          // Una pregunta de material en un servicio sin material no se mostraría
          // nunca; se degrada a pregunta normal en vez de quedar invisible.
          materialsOnly: state.materialsEnabled ? (q.materialsOnly ?? false) : false,
          options:
            q.answerType === 'SINGLE_CHOICE'
              ? q.options
                  .filter((o) => o.en.trim() !== '')
                  .map((o) => ({ en: o.en.trim(), fr: o.fr?.trim() || undefined }))
              : [],
        })),
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
                {SERVICE_LEVELS.map((lv) => (
                  <option key={lv.value} value={lv.value}>{lv.label}</option>
                ))}
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

          {/* Precios en DÓLARES. La API los guarda en centavos; la conversión
              es de ida y vuelta en @/lib/money. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label className="t-label">{t('services.basePriceMin')}</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--t-text-3)', fontSize: 14, pointerEvents: 'none' }}>$</span>
                <input
                  type="number" step="0.01" min="0" inputMode="decimal" placeholder="25"
                  className="t-input" style={{ paddingLeft: 26 }}
                  value={state.basePriceMin}
                  onChange={(e) => setState({ ...state, basePriceMin: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="t-label">{t('services.basePriceMax')}</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--t-text-3)', fontSize: 14, pointerEvents: 'none' }}>$</span>
                <input
                  type="number" step="0.01" min="0" inputMode="decimal" placeholder="45"
                  className="t-input" style={{ paddingLeft: 26 }}
                  value={state.basePriceMax}
                  onChange={(e) => setState({ ...state, basePriceMax: e.target.value })}
                />
              </div>
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
                {/* PER_CONTRACT invierte el modelo: el precio lo pone el CLIENTE
                    dentro del rango y el proveedor solo acepta. Sin decirlo aquí,
                    quien carga el catálogo no puede adivinarlo. */}
                <option value="per_contract">Per contract (customer sets the rate)</option>
                <option value="custom_quote">Custom quote</option>
              </select>
              {/* El rango cambia de significado en esta unidad: deja de acotar la
                  tarifa del proveedor y pasa a acotar lo que puede ofrecer el
                  cliente. Quien carga el catálogo tiene que saberlo antes de
                  escribir los números de arriba. */}
              {state.pricingUnit === 'per_contract' ? (
                <div style={{ fontSize: 12, color: 'var(--t-warn)', marginTop: 6 }}>
                  {t('services.perContractHelp') ||
                    'In this unit the CUSTOMER sets the hourly rate (within the range above) and the hours; providers only accept. Cancelling mid-job charges the full hours started.'}
                </div>
              ) : null}
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

          {/* Requisitos de credencial POR SERVICIO — el gate de L2/L3.
              Sustituye al gate por sección de la migración 029. */}
          <div
            style={{
              border: `1px solid ${credGateFails ? 'var(--t-warn)' : 'var(--t-border)'}`,
              borderRadius: 8, background: 'var(--t-deep)', padding: 14,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}
          >
            <div>
              <strong style={{ fontSize: 13, color: 'var(--t-text-1)' }}>
                {t('services.credentialRequirements')}
              </strong>
              <div style={{ fontSize: 12, color: 'var(--t-text-2)', marginTop: 2 }}>
                {needsCreds ? t('services.credentialRequirementsRequired') : t('services.credentialRequirementsOptional')}
              </div>
            </div>

            {state.credentialRequirements.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {state.credentialRequirements.map((r) => {
                  const opt = options.data?.find((o) => o.code === r.code);
                  const kind = opt?.kind ?? r.kind ?? 'CREDENTIAL';
                  return (
                    <div
                      key={r.code}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 10px', borderRadius: 6,
                        background: 'var(--t-surface)', border: '1px solid var(--t-border)',
                      }}
                    >
                      <span className="t-mono" style={{ fontSize: 11, fontWeight: 600, color: 'var(--t-text)', minWidth: 92 }}>
                        {r.code}
                      </span>
                      {kind !== 'CREDENTIAL' && (
                        <span className="t-chip t-chip-mono" style={{ fontSize: 9 }}>
                          {t(`services.kind.${kind}`)}
                        </span>
                      )}
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--t-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {opt?.labelEn ?? r.labelEn ?? ''}
                        {opt?.authority && <span style={{ color: 'var(--t-text-3)' }}> · {opt.authority}</span>}
                      </span>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--t-text-2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={r.mandatory} onChange={() => toggleMandatory(r.code)} />
                        {t('services.mandatory')}
                      </label>
                      <button
                        type="button"
                        className="t-btn t-btn-ghost t-btn-sm"
                        style={{ color: 'var(--t-danger)' }}
                        onClick={() => removeRequirement(r.code)}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
                <div style={{ fontSize: 11, color: 'var(--t-text-3)' }}>
                  {t('services.mandatoryHint')}
                </div>
              </div>
            )}

            {/* Agrupado por tipo: las credenciales de oficio son muchas y si no
                se separan, el seguro y el permiso se pierden en la lista. */}
            <select
              className="t-select"
              style={{ width: '100%' }}
              value=""
              onChange={(e) => { addRequirement(e.target.value); e.target.value = ''; }}
            >
              <option value="">
                {options.isLoading ? t('common.loading') : `+ ${t('services.addCredential')}`}
              </option>
              {REQUIREMENT_KIND_ORDER.map((kind) => {
                const group = (options.data ?? []).filter(
                  (o) => o.kind === kind && !state.credentialRequirements.some((r) => r.code === o.code),
                );
                if (group.length === 0) return null;
                return (
                  <optgroup key={kind} label={t(`services.kind.${kind}`)}>
                    {group.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.code} — {o.labelEn}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>

            {/* El seguro es el requisito más frecuente, así que tiene checkbox
                propio en vez de esconderse en el desplegable. Va en ESTE bloque
                —y no en el de "lo que aporta el cliente"— porque es algo que
                debe tener el PROVEEDOR para poder ofrecer el servicio.
                Por debajo escribe la misma fila CGL de
                service_credential_requirements: una sola fuente de verdad. */}
            <label
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                fontSize: 13, paddingTop: 4, borderTop: '1px solid var(--t-border)',
                marginTop: 4,
              }}
            >
              <input
                type="checkbox"
                checked={state.requiresInsurance}
                onChange={(e) => setState({ ...state, requiresInsurance: e.target.checked })}
                style={{ marginTop: 3 }}
              />
              <span>
                {t('services.requiresInsurance')}
                <span style={{ display: 'block', fontSize: 12, color: 'var(--t-text-3)' }}>
                  {t('services.requiresInsuranceHelp')}
                </span>
              </span>
            </label>

            {credGateFails && (
              <div style={{ fontSize: 12, color: 'var(--t-warn)' }}>
                ⚠ {t('services.credentialGateBlocked')}
              </div>
            )}
          </div>

          {/* MATERIALES (migración 043). El proveedor los compra y el cliente se los
              reembolsa. El rango acota lo que el cliente puede autorizar al reservar
              — mismo criterio que el rango de precio con la tarifa del proveedor —
              y la nota es el mensaje que el PROVEEDOR lee antes de ofertar.
              El material no lleva impuesto encima ni paga comisión de VISP. */}
          <div
            style={{
              border: `1px solid ${
                state.materialsEnabled &&
                (state.materialsBudgetMin.trim() === '' || state.materialsBudgetMax.trim() === '')
                  ? 'var(--t-warn)'
                  : 'var(--t-border)'
              }`,
              borderRadius: 8, background: 'var(--t-deep)', padding: 14,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}
          >
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={state.materialsEnabled}
                onChange={(e) => setState({ ...state, materialsEnabled: e.target.checked })}
                style={{ marginTop: 3 }}
              />
              <span>
                <strong style={{ color: 'var(--t-text-1)' }}>
                  {t('services.materialsEnabled') || 'This service needs materials'}
                </strong>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--t-text-3)' }}>
                  {t('services.materialsEnabledHelp') ||
                    'The provider buys them and the customer reimburses the receipt. No tax is added on top and VISP takes no commission on materials.'}
                </span>
              </span>
            </label>

            {state.materialsEnabled && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label className="t-label">
                      {t('services.materialsBudgetMin') || 'Budget min (CAD)'}
                    </label>
                    <input
                      type="number" step="0.01" min="0" className="t-input"
                      value={state.materialsBudgetMin}
                      onChange={(e) => setState({ ...state, materialsBudgetMin: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="t-label">
                      {t('services.materialsBudgetMax') || 'Budget max (CAD)'}
                    </label>
                    <input
                      type="number" step="0.01" min="0" className="t-input"
                      value={state.materialsBudgetMax}
                      onChange={(e) => setState({ ...state, materialsBudgetMax: e.target.value })}
                    />
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--t-text-3)' }}>
                  {t('services.materialsBudgetHelp') ||
                    'What the customer may authorise when booking. Spending above it needs their approval.'}
                </div>

                <div>
                  <label className="t-label">
                    {t('services.materialsNoteEn') || 'Message for the provider (EN)'}
                  </label>
                  <textarea
                    className="t-input" rows={2}
                    placeholder="Buy matte paint, keep the receipt."
                    value={state.materialsNoteEn}
                    onChange={(e) => setState({ ...state, materialsNoteEn: e.target.value })}
                  />
                </div>
                <div>
                  <label className="t-label">
                    {t('services.materialsNoteFr') || 'Message for the provider (FR)'}
                  </label>
                  <textarea
                    className="t-input" rows={2}
                    value={state.materialsNoteFr}
                    onChange={(e) => setState({ ...state, materialsNoteFr: e.target.value })}
                  />
                </div>

                {(state.materialsBudgetMin.trim() === '' || state.materialsBudgetMax.trim() === '') && (
                  <div style={{ fontSize: 12, color: 'var(--t-warn)' }}>
                    ⚠ {t('services.materialsRangeRequired') ||
                      'A service with materials needs a budget range: it is what the customer can authorise.'}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Qué debe aportar el CLIENTE al reservar (migración 038).
              Distinto del bloque de arriba: eso es lo que debe tener el
              PROVEEDOR. Esto es la información con la que el proveedor decide si
              acepta el trabajo con su rango de precio, así que la ve ANTES de
              aceptar. No cambia alcance ni precio: siguen saliendo del catálogo. */}
          <div
            style={{
              border: '1px solid var(--t-border)',
              borderRadius: 8, background: 'var(--t-deep)', padding: 14,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--t-text-2)' }}>
              {t('services.bookingInputTitle')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--t-text-3)', lineHeight: 1.5 }}>
              {t('services.bookingInputHelp')}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={state.requiresDetails}
                onChange={(e) => setState({ ...state, requiresDetails: e.target.checked })}
              />
              {t('services.requiresDetails')}
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={state.requiresEvidence}
                onChange={(e) => setState({ ...state, requiresEvidence: e.target.checked })}
              />
              {t('services.requiresEvidence')}
            </label>

            {/* El prompt se pide siempre que haya detalles obligatorios, y se
                ofrece igualmente cuando son opcionales: una caja en blanco invita
                a pedir cosas que nadie cotizó. */}
            <label className="t-field">
              <span className="t-label">
                {t('services.detailsPromptEn')}
                {state.requiresDetails ? ' *' : ''}
              </span>
              <textarea
                className="t-input"
                rows={2}
                value={state.detailsPromptEn}
                placeholder={t('services.detailsPromptPlaceholder')}
                onChange={(e) => setState({ ...state, detailsPromptEn: e.target.value })}
              />
            </label>

            <label className="t-field">
              <span className="t-label">{t('services.detailsPromptFr')}</span>
              <textarea
                className="t-input"
                rows={2}
                value={state.detailsPromptFr}
                onChange={(e) => setState({ ...state, detailsPromptFr: e.target.value })}
              />
            </label>

            {detailsPromptMissing && (
              <div style={{ fontSize: 12, color: 'var(--t-warn)' }}>
                ⚠ {t('services.detailsPromptRequired')}
              </div>
            )}
          </div>

          {/* Preguntas del servicio (migraciones 039/040).
              Dos tipos: texto libre (textarea, como los detalles) y opción
              cerrada. La opción cerrada es preferible siempre que se pueda: una
              respuesta de "Light/Normal/Heavy" es COMPARABLE entre reservas y el
              proveedor la entiende de un vistazo; el texto libre no. */}
          <div
            style={{
              border: '1px solid var(--t-border)',
              borderRadius: 8, background: 'var(--t-deep)', padding: 14,
              display: 'flex', flexDirection: 'column', gap: 12,
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--t-text-2)' }}>
              {t('services.questionsTitle')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--t-text-3)', lineHeight: 1.5 }}>
              {t('services.questionsHelp')}
            </div>

            {state.questions.map((q, qi) => {
              const update = (patch: Partial<TaskQuestion>) =>
                setState({
                  ...state,
                  questions: state.questions.map((x, i) =>
                    i === qi ? { ...x, ...patch } : x,
                  ),
                });
              const isChoice = q.answerType === 'SINGLE_CHOICE';
              const opciones = q.options ?? [];
              const pocasOpciones =
                isChoice && opciones.filter((o) => o.en.trim() !== '').length < 2;

              return (
                <div
                  key={q.id ?? `nueva-${qi}`}
                  style={{
                    border: '1px solid var(--t-border)', borderRadius: 8,
                    padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="t-chip t-chip-mono" style={{ fontSize: 10 }}>
                      {qi + 1}
                    </span>
                    <input
                      className="t-input"
                      style={{ flex: 1 }}
                      value={q.questionEn}
                      placeholder={t('services.questionPlaceholder')}
                      onChange={(e) => update({ questionEn: e.target.value })}
                    />
                    <button
                      type="button"
                      className="t-btn t-btn-ghost t-btn-sm"
                      style={{ color: 'var(--t-danger)' }}
                      onClick={() =>
                        setState({
                          ...state,
                          questions: state.questions.filter((_, i) => i !== qi),
                        })
                      }
                    >
                      {t('common.delete')}
                    </button>
                  </div>

                  <input
                    className="t-input"
                    value={q.questionFr ?? ''}
                    placeholder={t('services.questionPlaceholderFr')}
                    onChange={(e) => update({ questionFr: e.target.value })}
                  />

                  <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                      className="t-input"
                      style={{ width: 'auto' }}
                      value={q.answerType}
                      onChange={(e) => {
                        const answerType = e.target.value as TaskQuestion['answerType'];
                        update({
                          answerType,
                          // Al pasar a opción cerrada se siembran dos filas: una
                          // pregunta cerrada con menos de dos opciones no se puede
                          // responder y la API la rechaza.
                          options:
                            answerType === 'SINGLE_CHOICE' && opciones.length < 2
                              ? [{ en: '' }, { en: '' }]
                              : opciones,
                        });
                      }}
                    >
                      <option value="TEXT">{t('services.answerTypeText')}</option>
                      <option value="SINGLE_CHOICE">{t('services.answerTypeChoice')}</option>
                      {/* IMAGEN: la respuesta es una foto. El caso que lo pidió es el
                          color de pintura — descrito con palabras no sirve. */}
                      <option value="IMAGE">{t('services.answerTypeImage') || 'Photo'}</option>
                    </select>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={q.isRequired}
                        onChange={(e) => update({ isRequired: e.target.checked })}
                      />
                      {t('services.questionRequired')}
                    </label>

                    {/* Solo tiene sentido si el servicio lleva material: la pregunta
                        se muestra y se exige únicamente cuando el cliente lo pide. */}
                    {state.materialsEnabled && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={q.materialsOnly ?? false}
                          onChange={(e) => update({ materialsOnly: e.target.checked })}
                        />
                        {t('services.questionMaterialsOnly') || 'Only when materials are requested'}
                      </label>
                    )}
                  </div>

                  {isChoice && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {opciones.map((o, oi) => (
                        <div key={oi} style={{ display: 'flex', gap: 6 }}>
                          <input
                            className="t-input"
                            style={{ flex: 1 }}
                            value={o.en}
                            placeholder={t('services.optionPlaceholder')}
                            onChange={(e) =>
                              update({
                                options: opciones.map((x, i) =>
                                  i === oi ? { ...x, en: e.target.value } : x,
                                ),
                              })
                            }
                          />
                          <input
                            className="t-input"
                            style={{ flex: 1 }}
                            value={o.fr ?? ''}
                            placeholder={t('services.optionPlaceholderFr')}
                            onChange={(e) =>
                              update({
                                options: opciones.map((x, i) =>
                                  i === oi ? { ...x, fr: e.target.value } : x,
                                ),
                              })
                            }
                          />
                          <button
                            type="button"
                            className="t-btn t-btn-ghost t-btn-sm"
                            onClick={() =>
                              update({ options: opciones.filter((_, i) => i !== oi) })
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="t-btn t-btn-ghost t-btn-sm"
                        style={{ alignSelf: 'flex-start' }}
                        onClick={() => update({ options: [...opciones, { en: '' }] })}
                      >
                        + {t('services.addOption')}
                      </button>
                      {pocasOpciones && (
                        <div style={{ fontSize: 12, color: 'var(--t-warn)' }}>
                          ⚠ {t('services.optionsTooFew')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <button
              type="button"
              className="t-btn t-btn-ghost t-btn-sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() =>
                setState({
                  ...state,
                  questions: [
                    ...state.questions,
                    {
                      questionEn: '',
                      questionFr: '',
                      answerType: 'TEXT',
                      options: [],
                      isRequired: true,
                      displayOrder: state.questions.length,
                    },
                  ],
                })
              }
            >
              + {t('services.addQuestion')}
            </button>
          </div>

          {/* Flags — colapsados. El gate real vive ahora en los requisitos de
              credencial de arriba; estos flags quedan solo para el caso raro de
              un servicio que necesite marcar un atributo extra. */}
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

        <div className="t-modal-foot" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          {errorMessage && (
            <div style={{ fontSize: 12, color: 'var(--t-danger)', textAlign: 'right' }}>{errorMessage}</div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="t-btn t-btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button
              type="submit"
              className="t-btn t-btn-primary"
              disabled={
                submitting || credGateFails || detailsPromptMissing || questionOptionsInvalid
              }
            >
              {submitting && <span className="t-spinner" />}
              {form.id ? t('common.save') : t('common.create')}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/* =================== Modal 1: catálogo de requisitos ===================
   Lista todos los códigos (credenciales de oficio, seguros y permisos) para
   poder darlos de alta, editarlos o retirarlos sin tocar la base a mano. */
function RequirementCatalogModal({
  onClose,
  onNew,
  onEdit,
}: {
  onClose: () => void;
  onNew: () => void;
  onEdit: (o: CredentialRequirementOption) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  const q = useQuery<CredentialRequirementOption[]>({
    // Incluye los inactivos: si no, un código retirado desaparecería del gestor
    // y no habría forma de reactivarlo.
    queryKey: ['credential-requirement-catalog'],
    queryFn: () => adminService.credentialRequirementOptions(true),
  });

  const del = useMutation({
    mutationFn: (code: string) => adminService.deleteCredentialRequirement(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credential-requirement-catalog'] });
      qc.invalidateQueries({ queryKey: ['credential-requirement-options'] });
    },
  });

  const items = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = q.data ?? [];
    if (!needle) return all;
    return all.filter(
      (o) =>
        o.code.toLowerCase().includes(needle) ||
        o.labelEn.toLowerCase().includes(needle) ||
        (o.labelFr ?? '').toLowerCase().includes(needle) ||
        (o.authority ?? '').toLowerCase().includes(needle),
    );
  }, [q.data, search]);

  return (
    <div className="t-modal-backdrop" onClick={onClose}>
      <div className="t-modal" style={{ maxWidth: 780 }} onClick={(e) => e.stopPropagation()}>
        <div className="t-modal-head">
          <div>
            <span className="t-eyebrow">§ Catalog</span>
            <div className="t-h3" style={{ marginTop: 4 }}>{t('services.manageRequirements')}</div>
            <div style={{ fontSize: 12, color: 'var(--t-text-2)', marginTop: 4 }}>
              {t('services.manageRequirementsHint')}
            </div>
          </div>
          <button type="button" onClick={onClose} className="t-btn t-btn-ghost t-btn-sm">✕</button>
        </div>

        <div className="t-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div className="t-search" style={{ flex: 1 }}>
              <SearchIcon />
              <input
                type="search"
                placeholder={t('services.searchRequirement')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button type="button" className="t-btn t-btn-primary t-btn-sm" onClick={onNew}>
              + {t('services.newRequirement')}
            </button>
          </div>

          {q.isLoading && <div className="t-meta">{t('common.loading')}</div>}
          {del.error && (
            <div style={{ fontSize: 12, color: 'var(--t-danger)' }}>
              {(del.error as { message?: string }).message}
            </div>
          )}

          {REQUIREMENT_KIND_ORDER.map((kind) => {
            const group = items.filter((o) => o.kind === kind);
            if (group.length === 0) return null;
            return (
              <div key={kind} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="t-eyebrow" style={{ marginTop: 4 }}>
                  {t(`services.kind.${kind}`)} · {group.length}
                </div>
                {group.map((o) => (
                  <div
                    key={o.code}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 11px', borderRadius: 6,
                      background: 'var(--t-surface)', border: '1px solid var(--t-border)',
                      opacity: o.isActive === false ? 0.5 : 1,
                    }}
                  >
                    <span className="t-mono" style={{ fontSize: 11, fontWeight: 600, color: 'var(--t-text)', minWidth: 116 }}>
                      {o.code}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--t-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {o.labelEn}
                      </div>
                      <div className="t-mono" style={{ fontSize: 10, color: 'var(--t-text-3)', marginTop: 2 }}>
                        {o.authority || '—'} · {o.verificationMethod}
                        {o.isActive === false && ` · ${t('services.inactive')}`}
                      </div>
                    </div>
                    {/* Un código en uso no se puede borrar: dejaría servicios
                        L2/L3 sin requisitos, o sea inalcanzables. */}
                    <span
                      className="t-chip t-chip-mono"
                      style={{ fontSize: 9 }}
                      title={t('services.usedByServices')}
                    >
                      {o.usageCount ?? 0}
                    </span>
                    <button type="button" className="t-btn t-btn-ghost t-btn-sm" onClick={() => onEdit(o)}>
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      className="t-btn t-btn-ghost t-btn-sm"
                      style={{ color: 'var(--t-danger)' }}
                      disabled={(o.usageCount ?? 0) > 0 || del.isPending}
                      title={(o.usageCount ?? 0) > 0 ? t('services.cannotDeleteInUse') : undefined}
                      onClick={() => {
                        if (confirm(t('services.deleteRequirementConfirm', { code: o.code }))) {
                          del.mutate(o.code);
                        }
                      }}
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                ))}
              </div>
            );
          })}

          {!q.isLoading && items.length === 0 && (
            <div className="t-empty"><h3>{t('services.noRequirementsFound')}</h3></div>
          )}
        </div>

        <div className="t-modal-foot">
          <button type="button" className="t-btn t-btn-ghost" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}

/* =================== Modal 2: ficha de un requisito =================== */
function RequirementEditModal({
  form,
  onClose,
}: {
  form: RequirementFormState;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [state, setState] = useState<RequirementFormState>(form);
  const isEdit = Boolean(form.originalCode);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['credential-requirement-catalog'] });
    qc.invalidateQueries({ queryKey: ['credential-requirement-options'] });
    qc.invalidateQueries({ queryKey: ['taxonomy-full'] });
  };

  const create = useMutation({
    mutationFn: (body: CredentialRequirementUpsertBody) =>
      adminService.createCredentialRequirement(body),
    onSuccess: () => { invalidate(); onClose(); },
  });
  const update = useMutation({
    mutationFn: (body: Partial<CredentialRequirementUpsertBody>) =>
      adminService.updateCredentialRequirement(form.originalCode!, body),
    onSuccess: () => { invalidate(); onClose(); },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: CredentialRequirementUpsertBody = {
      labelEn: state.labelEn.trim(),
      labelFr: state.labelFr.trim() || null,
      kind: state.kind,
      authority: state.authority.trim() || null,
      registryName: state.registryName.trim() || null,
      registryUrl: state.registryUrl.trim() || null,
      verificationMethod: state.verificationMethod,
      description: state.description.trim() || null,
      isActive: state.isActive,
    };
    if (isEdit) update.mutate(body);
    else create.mutate({ ...body, code: state.code.trim().toUpperCase() });
  };

  const submitting = create.isPending || update.isPending;
  const error = ((create.error ?? update.error) as { message?: string } | null)?.message ?? null;

  return (
    <div className="t-modal-backdrop" onClick={onClose}>
      <form className="t-modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="t-modal-head">
          <div>
            <span className="t-eyebrow">§ {isEdit ? 'Edit' : 'New'}</span>
            <div className="t-h3" style={{ marginTop: 4 }}>
              {isEdit ? t('services.editRequirement') : t('services.newRequirement')}
            </div>
          </div>
          <button type="button" onClick={onClose} className="t-btn t-btn-ghost t-btn-sm">✕</button>
        </div>

        <div className="t-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12 }}>
            <div>
              <label className="t-label">{t('services.requirementCode')}</label>
              <input
                type="text"
                className="t-input t-mono"
                required
                // La PK la referencian los servicios: se fija al crear.
                disabled={isEdit}
                pattern="[A-Za-z0-9_]+"
                placeholder="CGL"
                value={state.code}
                onChange={(e) => setState({ ...state, code: e.target.value.toUpperCase() })}
              />
              <div style={{ fontSize: 11, color: 'var(--t-text-3)', marginTop: 4 }}>
                {isEdit ? t('services.requirementCodeLocked') : t('services.requirementCodeHint')}
              </div>
            </div>
            <div>
              <label className="t-label">{t('services.requirementKind')}</label>
              <select
                className="t-select"
                style={{ width: '100%' }}
                value={state.kind}
                onChange={(e) => setState({ ...state, kind: e.target.value as CredentialRequirementKind })}
              >
                {REQUIREMENT_KIND_ORDER.map((k) => (
                  <option key={k} value={k}>{t(`services.kind.${k}`)}</option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: 'var(--t-text-3)', marginTop: 4 }}>
                {t(`services.kindHint.${state.kind}`)}
              </div>
            </div>
          </div>

          <div>
            <label className="t-label">{t('services.requirementLabelEn')}</label>
            <input
              type="text" className="t-input" required
              placeholder="Commercial General Liability insurance"
              value={state.labelEn}
              onChange={(e) => setState({ ...state, labelEn: e.target.value })}
            />
          </div>
          <div>
            <label className="t-label">{t('services.requirementLabelFr')}</label>
            <input
              type="text" className="t-input"
              placeholder="Assurance responsabilité civile générale commerciale"
              value={state.labelFr}
              onChange={(e) => setState({ ...state, labelFr: e.target.value })}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="t-label">{t('services.requirementAuthority')}</label>
              <input
                type="text" className="t-input" placeholder="Skilled Trades Ontario"
                value={state.authority}
                onChange={(e) => setState({ ...state, authority: e.target.value })}
              />
            </div>
            <div>
              <label className="t-label">{t('services.requirementVerification')}</label>
              <select
                className="t-select" style={{ width: '100%' }}
                value={state.verificationMethod}
                onChange={(e) => setState({ ...state, verificationMethod: e.target.value as VerificationMethod })}
              >
                {VERIFICATION_METHODS.map((m) => (
                  <option key={m} value={m}>{t(`services.verification.${m}`)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Solo tiene sentido si se verifica contra un registro oficial. */}
          {state.verificationMethod === 'REGISTRY' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="t-label">{t('services.requirementRegistryName')}</label>
                <input
                  type="text" className="t-input" placeholder="Skilled Trades Ontario Public Register"
                  value={state.registryName}
                  onChange={(e) => setState({ ...state, registryName: e.target.value })}
                />
              </div>
              <div>
                <label className="t-label">{t('services.requirementRegistryUrl')}</label>
                <input
                  type="url" className="t-input" placeholder="https://..."
                  value={state.registryUrl}
                  onChange={(e) => setState({ ...state, registryUrl: e.target.value })}
                />
              </div>
            </div>
          )}

          <div>
            <label className="t-label">{t('services.requirementDescription')}</label>
            <textarea
              className="t-textarea"
              value={state.description}
              onChange={(e) => setState({ ...state, description: e.target.value })}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--t-text-2)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={state.isActive}
              onChange={(e) => setState({ ...state, isActive: e.target.checked })}
            />
            {t('services.isActive')}
          </label>
        </div>

        <div className="t-modal-foot" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          {error && <div style={{ fontSize: 12, color: 'var(--t-danger)', textAlign: 'right' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="t-btn t-btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="t-btn t-btn-primary" disabled={submitting}>
              {submitting && <span className="t-spinner" />}
              {isEdit ? t('common.save') : t('common.create')}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
