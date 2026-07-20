import { useEffect } from 'react';
import type { LegalDoc } from './legalContent';
import './Landing.css';

/**
 * Public legal document page (Terms / Privacy), styled to match the landing.
 * Reuses the `.visp-landing` design tokens; content comes from legalContent.ts.
 */
export default function LegalPage({ doc }: { doc: LegalDoc }) {
  // Land at the top when navigating in from a footer link.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [doc]);

  return (
    <div className="visp-landing" id="top">
      {/* Compact header */}
      <header className="header">
        <div className="wrap header-inner">
          <a href="/" className="logo">
            <svg className="logo-mark" viewBox="0 0 64 64" width="32" height="32">
              <circle cx="32" cy="32" r="26" fill="none" stroke="#2A2A2A" strokeWidth="2.5" />
              <path d="M 32 6 A 26 26 0 0 1 26 57.3" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M 9.2 22.5 A 26 26 0 0 1 12.5 16.4" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M 19.5 22 L 32 45 L 44.5 22" fill="none" stroke="#FFFFFF" strokeWidth="5.5" strokeLinejoin="miter" strokeLinecap="butt" />
            </svg>
            <span className="logo-text">VISP</span>
          </a>
          <div className="header-cta">
            <a href="/" className="btn btn-secondary">← Back to home</a>
          </div>
        </div>
      </header>

      {/* Document */}
      <section className="legal">
        <div className="wrap legal-doc">
          <h1 className="legal-title">{doc.title}</h1>
          <p className="legal-sub">{doc.subtitle}</p>
          {doc.sections.map((s) => (
            <div className="legal-section" key={s.heading}>
              <h3>{s.heading}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="wrap">
          <div className="footer-bottom">
            <div>© 2026 VISP TECHNOLOGIES, INC.</div>
            <div className="legal-footer-links">
              <a href="/legal/terms">Terms</a>
              <a href="/legal/privacy">Privacy</a>
              <a href="/">Home</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
