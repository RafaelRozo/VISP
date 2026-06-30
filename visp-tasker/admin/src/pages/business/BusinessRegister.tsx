/**
 * /business/register — owner sign-up for "VISP for Business".
 *
 * Two visible steps:
 *   1. Create the owner account (POST /auth/register, role=provider).
 *   2. Create the company (POST /companies).
 * On success, routes to /business which renders the document wizard while the
 * company is still in `draft`.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBusinessStore } from '@/stores/businessStore';
import { businessService } from '@/services/businessService';
import { BusinessTopBar, VispSprite } from './BusinessChrome';

export default function BusinessRegister() {
  const navigate = useNavigate();
  const { register, isAuthenticated, isHydrating, error, clearError } = useBusinessStore();

  const [step, setStep] = useState<1 | 2>(1);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Account fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');

  // Company fields
  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [website, setWebsite] = useState('');
  // Fiscal (registered) address + tax registration
  const [fiscalLine1, setFiscalLine1] = useState('');
  const [fiscalLine2, setFiscalLine2] = useState('');
  const [fiscalCity, setFiscalCity] = useState('');
  const [fiscalProvince, setFiscalProvince] = useState('');
  const [fiscalPostal, setFiscalPostal] = useState('');
  const [taxRegistered, setTaxRegistered] = useState(false);
  const [taxNumber, setTaxNumber] = useState('');

  useEffect(() => {
    // If the user already had a session and a company, send them straight in.
    if (!isHydrating && isAuthenticated && step === 1) {
      void (async () => {
        try {
          await businessService.getMyCompany();
          navigate('/business', { replace: true });
        } catch {
          setStep(2);
        }
      })();
    }
  }, [isHydrating, isAuthenticated, step, navigate]);

  const submitAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !firstName || !lastName) return;
    setSubmitting(true);
    setLocalError(null);
    clearError();
    try {
      await register({ email, password, firstName, lastName, phone: phone || undefined });
      if (!companyEmail) setCompanyEmail(email);
      if (!companyPhone) setCompanyPhone(phone);
      setStep(2);
    } catch {
      // error is in the store
    } finally {
      setSubmitting(false);
    }
  };

  const submitCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!legalName) return;
    setSubmitting(true);
    setLocalError(null);
    try {
      await businessService.createCompany({
        legal_name: legalName,
        trade_name: tradeName || undefined,
        business_address: businessAddress || undefined,
        phone: companyPhone || undefined,
        email: companyEmail || undefined,
        website: website || undefined,
        fiscal_address_line1: fiscalLine1 || undefined,
        fiscal_address_line2: fiscalLine2 || undefined,
        fiscal_city: fiscalCity || undefined,
        fiscal_province: fiscalProvince || undefined,
        fiscal_postal_code: fiscalPostal || undefined,
        fiscal_country: 'CA',
        tax_registered: taxRegistered,
        tax_number: taxNumber || undefined,
      });
      navigate('/business', { replace: true });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setLocalError(typeof detail === 'string' ? detail : 'Could not create the company.');
    } finally {
      setSubmitting(false);
    }
  };

  const shownError = localError || error;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--t-bg)' }}>
      <VispSprite />
      <BusinessTopBar />

      <div className="flex-1 grid place-items-center px-6 py-12">
        <div style={{ width: '100%', maxWidth: 520 }}>
          <div style={{ marginBottom: 28 }}>
            <span className="t-eyebrow">§ Register for Business</span>
            <h1 className="t-h1" style={{ marginTop: 12 }}>
              {step === 1 ? 'Create your account' : 'Tell us about your company'}
            </h1>
            <p className="t-lede" style={{ marginTop: 10 }}>
              {step === 1
                ? 'Register as the owner of your company on VISP.'
                : 'These details start your company profile. You will upload documents next.'}
            </p>
          </div>

          {/* Step indicator */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 22 }}>
            <StepDot active={step === 1} done={step > 1} n={1} label="Account" />
            <StepDot active={step === 2} done={false} n={2} label="Company" />
          </div>

          {shownError && (
            <div
              style={{
                marginBottom: 16,
                padding: '12px 14px',
                borderRadius: 8,
                border: '1px solid rgba(252,129,129,0.3)',
                background: 'rgba(252,129,129,0.08)',
                color: 'var(--t-danger)',
                fontSize: 13,
              }}
            >
              {shownError}
            </div>
          )}

          {step === 1 ? (
            <form className="t-card-base" style={{ padding: 26 }} onSubmit={submitAccount}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field label="First name">
                    <input
                      className="t-input"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </Field>
                  <Field label="Last name">
                    <input
                      className="t-input"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Email">
                  <input
                    className="t-input"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field label="Phone (optional)">
                  <input
                    className="t-input"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </Field>
                <Field label="Password">
                  <input
                    className="t-input"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <p className="t-meta" style={{ marginTop: 6 }}>
                    Minimum 8 characters.
                  </p>
                </Field>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="t-btn t-btn-primary t-btn-lg"
                style={{ width: '100%', marginTop: 22 }}
              >
                {submitting && <span className="t-spinner" />}
                Continue
              </button>
            </form>
          ) : (
            <form className="t-card-base" style={{ padding: 26 }} onSubmit={submitCompany}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Field label="Legal name">
                  <input
                    className="t-input"
                    required
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                  />
                </Field>
                <Field label="Trade name (optional)">
                  <input
                    className="t-input"
                    value={tradeName}
                    onChange={(e) => setTradeName(e.target.value)}
                  />
                </Field>
                <Field label="Business address (optional)">
                  <input
                    className="t-input"
                    value={businessAddress}
                    onChange={(e) => setBusinessAddress(e.target.value)}
                  />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field label="Company phone (optional)">
                    <input
                      className="t-input"
                      type="tel"
                      value={companyPhone}
                      onChange={(e) => setCompanyPhone(e.target.value)}
                    />
                  </Field>
                  <Field label="Company email (optional)">
                    <input
                      className="t-input"
                      type="email"
                      value={companyEmail}
                      onChange={(e) => setCompanyEmail(e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Website (optional)">
                  <input
                    className="t-input"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </Field>

                {/* Fiscal (registered) address — jurisdiction + tax responsibility */}
                <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--t-border)' }}>
                  <span className="t-eyebrow">§ Fiscal address &amp; tax</span>
                  <p className="t-meta" style={{ margin: '6px 0 12px' }}>
                    Your registered business address. VISP doesn’t file your taxes — you declare your
                    own earnings; this is on record for jurisdiction and compliance.
                  </p>
                </div>
                <Field label="Fiscal address — line 1">
                  <input className="t-input" value={fiscalLine1} onChange={(e) => setFiscalLine1(e.target.value)} />
                </Field>
                <Field label="Line 2 (optional)">
                  <input className="t-input" value={fiscalLine2} onChange={(e) => setFiscalLine2(e.target.value)} />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 12 }}>
                  <Field label="City">
                    <input className="t-input" value={fiscalCity} onChange={(e) => setFiscalCity(e.target.value)} />
                  </Field>
                  <Field label="Province">
                    <select className="t-select" style={{ width: '100%' }} value={fiscalProvince} onChange={(e) => setFiscalProvince(e.target.value)}>
                      <option value="">—</option>
                      {['ON', 'BC', 'AB', 'QC', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE', 'NT', 'NU', 'YT'].map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Postal code">
                    <input className="t-input" value={fiscalPostal} onChange={(e) => setFiscalPostal(e.target.value)} />
                  </Field>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--t-text-2)', cursor: 'pointer', marginTop: 6 }}>
                  <input type="checkbox" checked={taxRegistered} onChange={(e) => setTaxRegistered(e.target.checked)} />
                  Registered for GST/HST
                </label>
                {taxRegistered && (
                  <Field label="GST/HST number">
                    <input className="t-input" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} placeholder="123456789RT0001" />
                  </Field>
                )}
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="t-btn t-btn-primary t-btn-lg"
                style={{ width: '100%', marginTop: 22 }}
              >
                {submitting && <span className="t-spinner" />}
                Create company &amp; continue
              </button>
            </form>
          )}

          <p className="t-meta" style={{ marginTop: 18, textAlign: 'center' }}>
            Already have a business account?{' '}
            <Link to="/business/login" style={{ color: 'var(--t-violet)' }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="t-label">{label}</label>
      {children}
    </div>
  );
}

function StepDot({
  active,
  done,
  n,
  label,
}: {
  active: boolean;
  done: boolean;
  n: number;
  label: string;
}) {
  const color = active || done ? 'var(--t-violet)' : 'var(--t-text-3)';
  const border = active || done ? 'var(--t-violet-line)' : 'var(--t-border)';
  const bg = active || done ? 'var(--t-violet-wash)' : 'transparent';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        borderRadius: 6,
        border: `1px solid ${border}`,
        background: bg,
        color,
      }}
    >
      <span className="t-mono" style={{ fontSize: 12 }}>
        {done ? '✓' : n}
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
    </div>
  );
}
