import { useState } from 'react';
import { Config } from '@/services/config';
import LangSwitcher from '@/components/LangSwitcher';
import './Landing.css';

const REQUEST_URL = Config.appStoreUrl;
const PROVIDER_URL = Config.appStoreUrl;

const NAV_LINKS = [
  { href: '#how', label: 'How It Works' },
  { href: '#customers', label: 'Customers' },
  { href: '#providers', label: 'Providers' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#safety', label: 'Safety' },
  { href: '#faq', label: 'FAQ' },
];

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="visp-landing" id="top">
      <SvgSprite />

      {/* ============ HEADER ============ */}
      <header className={`header ${menuOpen ? 'menu-open' : ''}`}>
        <div className="wrap header-inner">
          <a href="#top" className="logo" onClick={closeMenu}>
            <svg className="logo-mark"><use href="#visp-mark" /></svg>
            <span className="logo-text">VISP</span>
            <span className="logo-sub">Verified Independent Service Providers</span>
          </a>
          <nav className={`nav ${menuOpen ? 'nav-open' : ''}`}>
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={closeMenu}>{l.label}</a>
            ))}
            {/* Mobile-only actions surfaced inside the dropdown */}
            {/* Business registration is deferred to a later release.
            <a href="/business/register" className="nav-mobile-only nav-cta-line" onClick={closeMenu}>
              Register for Business
            </a>
            */}
            <a
              href={REQUEST_URL}
              target="_blank"
              rel="noreferrer"
              className="nav-mobile-only btn btn-primary nav-cta-btn"
              onClick={closeMenu}
            >
              Request a Job
            </a>
          </nav>
          <div className="header-cta">
            {/* Business registration is deferred to a later release.
            <a href="/business/register" className="btn btn-secondary">Register for Business</a>
            */}
            <a href={REQUEST_URL} target="_blank" rel="noreferrer" className="btn btn-primary">Request a Job</a>
            <div className="header-lang"><LangSwitcher /></div>
            <button
              type="button"
              className="menu-toggle"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span /><span /><span />
            </button>
          </div>
        </div>
      </header>
      {/* Tap-away backdrop closes the mobile menu */}
      {menuOpen && <div className="nav-backdrop" onClick={closeMenu} aria-hidden="true" />}

      {/* ============ HERO ============ */}
      <section className="hero" id="hero">
        <div className="wrap hero-grid">
          <div>
            <div className="hero-tag">
              <span>14 cities</span>
              <span className="div"></span>
              <span><b>4,200+</b> verified providers</span>
              <span className="div"></span>
              <span>ISO-certified payments</span>
            </div>
            <h1 className="hero-title">
              Hire verified people<br />to <span className="accent">get any job done</span> near you.
            </h1>
            <p className="hero-sub">
              VISP is a marketplace for everyday work — cleaning, moving, repairs, deliveries, errands and more. Post the job. Get matched with verified providers nearby. Pay securely when it's done.
            </p>
            <div className="hero-cta">
              <a href={REQUEST_URL} target="_blank" rel="noreferrer" className="btn btn-primary btn-lg">
                Request a Job <span className="arrow"><svg width="14" height="14"><use href="#i-arrow" /></svg></span>
              </a>
              <a href="#providers" className="btn btn-secondary btn-lg">Become a Provider</a>
            </div>
            <div className="hero-promise">
              <span><b>01</b> Post</span>
              <span><b>02</b> Match</span>
              <span><b>03</b> Done</span>
            </div>
          </div>

          <div className="hero-mockup">
            <div className="frame">
              <div className="frame-bar">
                <div className="frame-bar-left">
                  <span className="dot"></span><span className="dot"></span><span className="dot"></span>
                </div>
                <div className="frame-bar-title">VISP · Job Request</div>
                <div className="frame-bar-id">REQ-0421</div>
              </div>

              <div className="mock-card">
                <div className="job-card-h">
                  <span className="tag">New Request</span>
                  <span className="id">09:42 · Today</span>
                </div>
                <h3 className="job-title">Move couch upstairs</h3>
                <div className="job-meta">
                  <div><span className="l">When</span><span className="v">Today, 4:30 PM</span></div>
                  <div><span className="l">Distance</span><span className="v">1.8 km away</span></div>
                  <div><span className="l">Estimate</span><span className="v">$45–$70</span></div>
                </div>
                <div className="job-cats">
                  <span className="chip live">3 verified providers available</span>
                  <span className="chip">Moving</span>
                  <span className="chip">Heavy lift</span>
                  <span className="chip">Same day</span>
                </div>
              </div>

              <div className="mock-card" style={{ padding: '6px 18px' }}>
                {[
                  { initials: 'MR', name: 'Marcus R.', rating: '4.9', jobs: 312, distance: '1.2 km', price: '$58', eta: '~45 min' },
                  { initials: 'SK', name: 'Sarah K.', rating: '4.96', jobs: 487, distance: '0.8 km', price: '$62', eta: '~40 min' },
                  { initials: 'JT', name: 'James T.', rating: '4.8', jobs: 156, distance: '2.1 km', price: '$55', eta: '~50 min' },
                ].map((p) => (
                  <div className="provider-row" key={p.initials}>
                    <div className="av">{p.initials}</div>
                    <div className="provider-info">
                      <div className="provider-name">
                        <b>{p.name}</b>
                        <span className="vbadge"><svg><use href="#i-check" /></svg> Verified</span>
                      </div>
                      <div className="provider-meta-line"><b>★ {p.rating}</b> · {p.jobs} jobs · {p.distance}</div>
                    </div>
                    <div className="provider-price"><b>{p.price}</b><small>{p.eta}</small></div>
                  </div>
                ))}
              </div>

              <div className="mock-card secure-row">
                <div className="left">
                  <svg><use href="#i-lock" /></svg>
                  <span className="label-txt">Secure payment ready</span>
                </div>
                <span className="escrow-tag">ESCROW · ENABLED</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ TRUST BAR ============ */}
      <div className="trust">
        <div className="wrap trust-row">
          <span className="trust-item"><svg><use href="#i-shield" /></svg> Verified profiles</span>
          <span className="trust-item"><svg><use href="#i-lock" /></svg> Secure in-app payments</span>
          <span className="trust-item"><svg><use href="#i-pin" /></svg> Local matching</span>
          <span className="trust-item"><svg><use href="#i-star" /></svg> Reviews &amp; ratings</span>
          <span className="trust-item"><svg><use href="#i-msg" /></svg> Real human support</span>
        </div>
      </div>

      {/* ============ PROBLEM ============ */}
      <section>
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">§ Problem</span>
            <h2 className="h2">Finding reliable local help shouldn't feel like guessing.</h2>
            <p className="lede">Group chats, sketchy listings, last-minute cancellations, payment chasing. Local jobs deserve a real system — not improvisation.</p>
          </div>
          <div className="problem-grid">
            {[
              { n: '01', h: 'Asking around is slow.', p: 'Group chats and "got anyone for this?" eat your week. Half the responses never arrive.' },
              { n: '02', h: 'Random listings feel risky.', p: "No identity verification, no recourse, no clear pricing. You're guessing on every booking." },
              { n: '03', h: "Providers can't find consistent work.", p: 'Real skills, scattered demand. No easy way to fill gaps in the calendar or get paid on time.' },
              { n: '04', h: 'Local jobs need a better system.', p: 'Identity, matching, payment, reviews, dispute support — in one place. Built for both sides.' },
            ].map((it) => (
              <div className="problem-item" key={it.n}>
                <span className="problem-num">{it.n}</span>
                <div>
                  <h4>{it.h}</h4>
                  <p>{it.p}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section id="how" className="section-how">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">§ How it works</span>
            <h2 className="h2">From "I need this done" to done — in four steps.</h2>
          </div>
          <div className="steps">
            {[
              { n: 'STEP 01', h: 'Post the job', p: 'Describe what you need, when you need it, and where. Photos and budget optional.' },
              { n: 'STEP 02', h: 'Get matched', p: 'VISP surfaces verified providers nearby who fit your job, schedule, and budget.' },
              { n: 'STEP 03', h: 'Choose your provider', p: 'Compare ratings, distance, availability, and estimated pricing side by side.' },
              { n: 'STEP 04', h: 'Get it done', p: 'Track the job, message the provider, pay securely, leave a review when complete.' },
            ].map((s) => (
              <div className="step" key={s.n}>
                <span className="step-num">{s.n}</span>
                <h3>{s.h}</h3>
                <p>{s.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FOR CUSTOMERS ============ */}
      <section id="customers">
        <div className="wrap">
          <div className="audience-block">
            <div className="audience-text">
              <span className="eyebrow" style={{ display: 'block', marginBottom: 14 }}>§ For Customers</span>
              <h2 className="h2">Need help? VISP it.</h2>
              <p className="lede">Request almost any job and get matched with verified people nearby. Real help, ready when you need it.</p>
              <div className="usecase-list">
                {['Moving furniture','Same-day errands','Cleaning help','Home repairs','Yard work','Event support','Local deliveries','Custom tasks']
                  .map((u) => <span className="uc" key={u}>{u}</span>)}
              </div>
              <a href={REQUEST_URL} target="_blank" rel="noreferrer" className="btn btn-primary btn-lg">
                Request a Job <span className="arrow"><svg width="14" height="14"><use href="#i-arrow" /></svg></span>
              </a>
            </div>
            <div>
              <div className="audience-frame">
                <div className="feed-head">
                  <h4>Your active jobs</h4>
                  <small>04 OPEN</small>
                </div>
                {[
                  { icon: 'i-broom', title: 'Deep clean — 2 bed apt', meta: 'SAT 10:00 · 2.3 KM · 4 OFFERS', price: '$120–160', status: 'MATCHING', statusClass: 'live' },
                  { icon: 'i-truck', title: 'Move couch upstairs', meta: 'TODAY 16:30 · 1.8 KM · 3 OFFERS', price: '$45–70', status: 'MATCHING', statusClass: 'live' },
                  { icon: 'i-wrench', title: 'Fix leaking kitchen sink', meta: 'TOMORROW · 0.9 KM · MARCUS R.', price: '$85', status: 'BOOKED', statusClass: 'booked' },
                  { icon: 'i-leaf', title: 'Yard cleanup + leaves', meta: 'SUN 09:00 · 3.1 KM · 2 OFFERS', price: '$70–110', status: 'MATCHING', statusClass: 'live' },
                ].map((f) => (
                  <div className="feed-row" key={f.title}>
                    <div className="feed-row-left">
                      <div className="feed-icon"><svg><use href={`#${f.icon}`} /></svg></div>
                      <div className="feed-info">
                        <b>{f.title}</b>
                        <small>{f.meta}</small>
                      </div>
                    </div>
                    <div className="feed-row-right">
                      <div className="price">{f.price}</div>
                      <div className={`status ${f.statusClass}`}>{f.status}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ FOR PROVIDERS ============ */}
      <section id="providers" className="audience">
        <div className="wrap">
          <div className="audience-block reverse">
            <div className="audience-text">
              <span className="eyebrow" style={{ display: 'block', marginBottom: 14 }}>§ For Providers</span>
              <h2 className="h2">Earn with the skills you already have.</h2>
              <p className="lede">Turn your time, tools, experience, or trade into flexible income. Built for everyday jobs and serious service providers.</p>
              <div className="usecase-list">
                {['Cleaners','Movers','Handymen','Drivers','Tutors','Beauty pros','Tech help','Small businesses']
                  .map((u) => <span className="uc" key={u}>{u}</span>)}
              </div>
              <a href={PROVIDER_URL} target="_blank" rel="noreferrer" className="btn btn-primary btn-lg">
                Become a Provider <span className="arrow"><svg width="14" height="14"><use href="#i-arrow" /></svg></span>
              </a>
            </div>
            <div>
              <div className="audience-frame">
                <div className="feed-head">
                  <h4>This week's earnings</h4>
                  <small>WK 21 · 2026</small>
                </div>
                <div className="earn-stat">
                  <div className="l">Gross earnings</div>
                  <div className="v"><span className="cur">$</span>1,284</div>
                  <div className="delta">↑ 18% vs last week</div>
                </div>
                <div className="earn-bars">
                  {[32, 48, 30, 62, 88, 72, 54].map((h, i) => (
                    <div key={i} className={`bar ${i === 4 ? 'now' : ''}`} style={{ height: `${h}%` }} />
                  ))}
                </div>
                <div className="earn-foot">
                  {['MON','TUE','WED','THU','FRI','SAT','SUN'].map((d) => <span key={d}>{d}</span>)}
                </div>
              </div>

              <div className="audience-frame" style={{ marginTop: 14 }}>
                <div className="feed-head">
                  <h4>Available near you</h4>
                  <small>08 OPEN</small>
                </div>
                {[
                  { icon: 'i-wrench', title: 'Mount TV — 65"', meta: '1.2 KM · TODAY · 30 MIN', price: '$75', status: 'APPLY' },
                  { icon: 'i-package', title: 'Pickup & delivery — IKEA', meta: '2.8 KM · TOMORROW · 2 HR', price: '$95', status: 'APPLY' },
                ].map((f) => (
                  <div className="feed-row" key={f.title}>
                    <div className="feed-row-left">
                      <div className="feed-icon"><svg><use href={`#${f.icon}`} /></svg></div>
                      <div className="feed-info">
                        <b>{f.title}</b>
                        <small>{f.meta}</small>
                      </div>
                    </div>
                    <div className="feed-row-right">
                      <div className="price">{f.price}</div>
                      <div className="status">{f.status}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ CATEGORIES ============ */}
      <section>
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">§ Categories</span>
            <h2 className="h2">Built for everyday jobs — and serious service providers.</h2>
            <p className="lede">From a single errand to a full-day project, VISP covers the work people actually need done.</p>
          </div>
          <div className="cats">
            {[
              { n: '01', icon: 'i-broom', h: 'Cleaning', p: 'Homes, offices, post-move, deep cleans.' },
              { n: '02', icon: 'i-truck', h: 'Moving', p: 'Heavy lifting, full moves, single items.' },
              { n: '03', icon: 'i-wrench', h: 'Handyman', p: 'Repairs, mounting, assembly, fixes.' },
              { n: '04', icon: 'i-package', h: 'Delivery', p: 'Pickups, drop-offs, courier runs.' },
              { n: '05', icon: 'i-bolt', h: 'Errands', p: 'Shopping, returns, line-waiting.' },
              { n: '06', icon: 'i-paw', h: 'Pet Care', p: 'Walks, sitting, drop-ins, transport.' },
              { n: '07', icon: 'i-leaf', h: 'Yard Work', p: 'Lawns, leaves, snow, seasonal cleanup.' },
              { n: '08', icon: 'i-laptop', h: 'Tech Help', p: 'Setup, troubleshooting, smart home.' },
              { n: '09', icon: 'i-spark', h: 'Beauty', p: 'Hair, nails, lash, at-home services.' },
              { n: '10', icon: 'i-book', h: 'Tutoring', p: 'K–12, test prep, languages, music.' },
              { n: '11', icon: 'i-cal', h: 'Event Help', p: 'Setup, staffing, teardown, day-of.' },
              { n: '12', icon: 'i-grid', h: 'Custom Jobs', p: 'If a person can do it, post it.' },
            ].map((c) => (
              <div className="cat" key={c.n}>
                <span className="cat-num">{c.n}</span>
                <div className="cat-icon"><svg><use href={`#${c.icon}`} /></svg></div>
                <h4>{c.h}</h4>
                <p>{c.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ SAFETY ============ */}
      <section id="safety" className="section-safety">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">§ Safety &amp; Verification</span>
            <h2 className="h2">Built around trust — not random gig work.</h2>
            <p className="lede">Every provider is verified before they can accept a job. Every payment runs through VISP. Every job is reviewed.</p>
          </div>
          <div className="safety-grid">
            {[
              { tag: 'VER-01 · Identity', h: 'Verified provider profiles', p: 'ID checks, background screening on eligible categories, and credential review before any provider goes live.' },
              { tag: 'REV-02 · Reputation', h: 'Ratings and reviews', p: 'Every job ends with a real review. Providers earn their place. Customers see the truth before they book.' },
              { tag: 'PAY-03 · Payment', h: 'Secure in-app payments', p: 'Funds are held until the job is marked complete. No cash awkwardness. No payment chasing.' },
              { tag: 'SCP-04 · Scope', h: 'Clear job details', p: 'Scope, schedule, address, budget — agreed before the job starts. No silent scope creep.' },
              { tag: 'BDG-05 · Trust', h: 'Provider trust badges', p: 'Top Rated, Background Verified, Insured, Pro Account — badges customers can read at a glance.' },
              { tag: 'SUP-06 · Support', h: 'Dispute support', p: 'Real humans on standby. If something goes sideways, our team mediates and protects both sides.' },
            ].map((s) => (
              <div className="safety-item" key={s.tag}>
                <span className="tag">{s.tag}</span>
                <h4>{s.h}</h4>
                <p>{s.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ PRICING ============ */}
      <section id="pricing" className="pricing">
        <div className="wrap">
          <div className="section-head" style={{ paddingTop: 0, marginBottom: 48 }}>
            <span className="eyebrow">§ Provider Pricing</span>
            <h2 className="h2">Get the edge. Get the jobs.</h2>
            <p className="lede">Customers pay nothing to post. Providers compete for work. Upgrade your profile to win more of it — better placement, more leads, trust badges that close deals before a message is even sent.</p>
          </div>

          <div className="fee-note">
            <div className="fee-note-row">
              <span className="fee-tag mono">§ For Customers</span>
              <p><b>Free to post. Free to browse. Free to book.</b> VISP takes a small service fee on completed jobs — shown clearly before you pay. No subscription, no hidden charges.</p>
            </div>
          </div>

          <div className="tiers">
            <div className="tier">
              <div className="tier-head">
                <h4>Starter</h4>
                <div className="tier-price"><span className="cur">$</span><span className="amt">0</span><span className="per">/ month</span></div>
                <p className="tier-pitch">Get on the platform. Apply to any open job. Build your reputation from zero.</p>
              </div>
              <ul>
                <li>Create a verified provider profile</li>
                <li>Apply to available jobs</li>
                <li>Build ratings and reviews</li>
                <li>Receive secure payouts</li>
                <li>Standard search placement</li>
              </ul>
              <a href={PROVIDER_URL} target="_blank" rel="noreferrer" className="tier-cta">Create profile</a>
            </div>
            <div className="tier featured">
              <div className="tier-head">
                <h4>Pro · Most Popular</h4>
                <div className="tier-price"><span className="cur">$</span><span className="amt">19</span><span className="per">/ month</span></div>
                <p className="tier-pitch">Outrank free providers in matching. The upgrade most active providers make in their first month.</p>
              </div>
              <ul>
                <li>Higher profile visibility in matching</li>
                <li>2× job application limit</li>
                <li>Early access to new jobs (10-min window)</li>
                <li>"Pro" profile trust badge</li>
                <li>Reduced platform fee on completed jobs</li>
              </ul>
              <a href={PROVIDER_URL} target="_blank" rel="noreferrer" className="tier-cta">Go Pro</a>
            </div>
            <div className="tier">
              <div className="tier-head">
                <h4>Elite</h4>
                <div className="tier-price"><span className="cur">$</span><span className="amt">49</span><span className="per">/ month</span></div>
                <p className="tier-pitch">For serious providers and small service businesses running VISP as a real revenue channel.</p>
              </div>
              <ul>
                <li>Top placement in matching results</li>
                <li>Premium high-value leads</li>
                <li>"Elite" + "Insured" trust badges</li>
                <li>Lowest platform fee</li>
                <li>Priority human support</li>
                <li>Multi-service &amp; team accounts</li>
              </ul>
              <a href={PROVIDER_URL} target="_blank" rel="noreferrer" className="tier-cta">Become Elite</a>
            </div>
          </div>

          <p className="pricing-foot mono">Cancel anytime · No long-term contract · Switch tiers monthly</p>
        </div>
      </section>

      {/* ============ APP PREVIEW ============ */}
      <section>
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">§ Inside the marketplace</span>
            <h2 className="h2">A real marketplace — organized, fast, and easy to run.</h2>
            <p className="lede">From request to review — every job moves through the same operational pipeline.</p>
          </div>
          <div className="preview-grid">

            <div className="preview-card w4">
              <div className="pv-head">
                <span className="l">Active job feed</span>
                <span className="r">LIVE · 12 JOBS</span>
              </div>
              <div className="pv-row"><span className="label">Deep clean — 2 bed apt · Oakville</span><span className="value violet">MATCHING</span></div>
              <div className="pv-row"><span className="label">Move couch upstairs · Burlington</span><span className="value">3 OFFERS</span></div>
              <div className="pv-row"><span className="label">Mount 65" TV + cable hide</span><span className="value">BOOKED · MARCUS R.</span></div>
              <div className="pv-row"><span className="label">Costco pickup + delivery</span><span className="value">$95 FIXED</span></div>
              <div className="pv-row"><span className="label">Dog walk · 45 min · daily</span><span className="value">2 OFFERS</span></div>
            </div>

            <div className="preview-card w2">
              <div className="pv-head">
                <span className="l">Provider profile</span>
                <span className="r">PRO</span>
              </div>
              <div className="profile-block">
                <div className="av-lg">SK</div>
                <div>
                  <b>Sarah K.</b>
                  <small>VERIFIED · 0.8 KM</small>
                </div>
              </div>
              <div className="profile-stats">
                <div className="st"><b>4.96</b><small>★ RATING</small></div>
                <div className="st"><b>487</b><small>JOBS</small></div>
                <div className="st"><b>2 YR</b><small>ON VISP</small></div>
              </div>
            </div>

            <div className="preview-card w2">
              <div className="pv-head">
                <span className="l">Payment status</span>
                <span className="r violet">SECURED</span>
              </div>
              <div className="pv-row"><span className="label">Job total</span><span className="value">$148.00</span></div>
              <div className="pv-row"><span className="label">Service fee</span><span className="value">$7.40</span></div>
              <div className="pv-row"><span className="label">Held in escrow</span><span className="value violet">$155.40</span></div>
              <div className="pv-row"><span className="label">Releases on</span><span className="value">COMPLETION</span></div>
            </div>

            <div className="preview-card w2">
              <div className="pv-head">
                <span className="l">Match strength</span>
                <span className="r">RT-7821</span>
              </div>
              <div className="match-block">
                <div className="match-num">78<span className="pct">%</span></div>
                <p><b>3 providers</b> matched<br />within 1.5 km</p>
              </div>
            </div>

            <div className="preview-card w2">
              <div className="pv-head">
                <span className="l">Job details</span>
                <span className="r">JOB-2104</span>
              </div>
              <div className="pv-row"><span className="label">Category</span><span className="value">MOVING</span></div>
              <div className="pv-row"><span className="label">Scheduled</span><span className="value">TUE 14:00</span></div>
              <div className="pv-row"><span className="label">Duration</span><span className="value">~45 MIN</span></div>
              <div className="pv-row"><span className="label">Address</span><span className="value">QUEEN ST W</span></div>
            </div>

            <div className="preview-card w4">
              <div className="pv-head">
                <span className="l">Latest review</span>
                <span className="r">RV-2104</span>
              </div>
              <div className="review-stars">
                <svg><use href="#i-star" /></svg>
                <svg><use href="#i-star" /></svg>
                <svg><use href="#i-star" /></svg>
                <svg><use href="#i-star" /></svg>
                <svg><use href="#i-star" /></svg>
              </div>
              <p className="review-text">"Marcus showed up exactly when he said, moved everything in under an hour, and even helped reposition the new couch. Will book again."</p>
              <div className="review-foot">
                <span>— JENNA T.</span>
                <span>· MOVING</span>
                <span>· BURLINGTON</span>
                <span>· 2 DAYS AGO</span>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ============ BUSINESS ============ */}
      <section className="business">
        <div className="wrap">
          <div className="biz-grid">
            <div>
              <span className="eyebrow" style={{ display: 'block', marginBottom: 14 }}>§ For Business</span>
              <h2 className="h2">Need extra hands for your business?</h2>
              <p className="lede" style={{ marginBottom: 28 }}>Local cafes, retail shops, event teams, property managers and small operations use VISP to find verified help fast — without recruiters or long contracts.</p>
              <a href={REQUEST_URL} target="_blank" rel="noreferrer" className="btn btn-primary btn-lg">
                Find Help for Your Business <span className="arrow"><svg width="14" height="14"><use href="#i-arrow" /></svg></span>
              </a>
            </div>
            <div className="biz-tags">
              {['Event staffing','Deliveries','Cleaning','Setup & teardown','Admin tasks','Maintenance','Seasonal overflow','Local support']
                .map((t) => <span className="t" key={t}>{t}</span>)}
            </div>
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="final">
        <div className="wrap final-inner">
          <h2>Need something done? <span className="accent">VISP it.</span></h2>
          <p>Request a job in minutes — or become a verified provider and start earning from local opportunities.</p>
          <div className="final-cta">
            <a href={REQUEST_URL} target="_blank" rel="noreferrer" className="btn btn-primary btn-lg">
              Request a Job <span className="arrow"><svg width="14" height="14"><use href="#i-arrow" /></svg></span>
            </a>
            <a href="#providers" className="btn btn-secondary btn-lg">Become a Provider</a>
          </div>
        </div>
      </section>

      {/* ============ FAQ ============ */}
      <section id="faq" className="faq">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">§ FAQ</span>
            <h2 className="h2">Questions, answered.</h2>
          </div>
          <div className="faq-grid">
            {[
              { n: '01', q: 'What kind of jobs can I request?', a: 'Almost anything a real person can do — cleaning, moving, repairs, errands, deliveries, pet care, yard work, tech help, beauty services, tutoring, event support, admin work, and fully custom tasks. If a person can do it, you can post it.', open: true },
              { n: '02', q: 'Who can become a provider?', a: 'Anyone 18+ with a verifiable identity and the skills to do the work they list. Tradespeople, freelancers, students, drivers, cleaners, beauty pros, tutors, and small service businesses all use VISP. Some categories require additional credentials before going live.' },
              { n: '03', q: 'How does verification work?', a: 'Every provider verifies their identity with a government-issued ID. Eligible categories also include background screening and credential review (trade licenses, insurance, references). Verified providers receive a badge customers can see on every offer.' },
              { n: '04', q: 'How do providers get paid?', a: "Customers pay through VISP. Funds are held securely until the job is marked complete, then released to the provider's connected account. Payouts typically arrive within 1–2 business days." },
              { n: '05', q: 'Can businesses use VISP?', a: 'Yes. Businesses use VISP for event staffing, deliveries, cleaning, setup and teardown, maintenance, admin overflow, and seasonal help. Business accounts unlock multi-job posting and team management.' },
              { n: '06', q: 'Is VISP available in my city?', a: "VISP is live in 14 cities and expanding monthly. Drop your postal code on the request page to see the active provider pool near you — if we're not live in your area yet, we'll notify you the moment we are." },
              { n: '07', q: 'What happens if there is a problem with a job?', a: 'Open a dispute from the job page and our support team steps in. Payment is held until the issue is resolved. Both customers and providers are protected by clear policies and human review.' },
              { n: '08', q: 'Can providers offer multiple services?', a: "Yes. Add as many service categories as you're qualified for. Providers offering multiple verified services typically receive more matches and higher weekly earnings." },
            ].map((f) => (
              <details className="faq-item" key={f.n} {...(f.open ? { open: true } : {})}>
                <summary>
                  <span className="q-num">{f.n}</span>
                  <span>{f.q}</span>
                  <span className="q-icon" />
                </summary>
                <div className="faq-body">{f.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="footer">
        <div className="wrap">
          <div className="footer-grid">
            <div className="footer-brand">
              <a href="#top" className="logo">
                <svg className="logo-mark"><use href="#visp-mark" /></svg>
                <span className="logo-text">VISP</span>
              </a>
              <p>The verified local service marketplace. Post the job. Get matched. Get it done.</p>
            </div>
            <div>
              <h5>For Providers</h5>
              <ul>
                <li><a href="#providers">Become a Provider</a></li>
                <li><a href="#pricing">Provider Pricing</a></li>
                <li><a href="#safety">Verification</a></li>
                <li><a href="/legal/terms">Provider Terms</a></li>
              </ul>
            </div>
            <div>
              <h5>For Customers</h5>
              <ul>
                <li><a href="#customers">Request a Job</a></li>
                <li><a href="#how">How It Works</a></li>
                <li><a href="#safety">Trust &amp; Safety</a></li>
                <li><a href="#faq">FAQ</a></li>
              </ul>
            </div>
            <div>
              <h5>Company</h5>
              <ul>
                <li><a href="#faq">FAQ</a></li>
                <li><a href="mailto:hello@vispapp.com">Contact</a></li>
                <li><a href="/legal/privacy">Privacy</a></li>
                <li><a href="/legal/terms">Terms</a></li>
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            <div>© 2026 VISP TECHNOLOGIES, INC.</div>
            <div>VERIFIED LOCAL HELP FOR EVERYDAY JOBS</div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* =================================================================
   SVG sprite — logo + all icons used in the landing.
   Defined once, referenced via <use href="#…" /> throughout.
   ================================================================= */
function SvgSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="visp-mark" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="26" fill="none" stroke="#2A2A2A" strokeWidth="2.5" />
          <path d="M 32 6 A 26 26 0 0 1 26 57.3" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M 9.2 22.5 A 26 26 0 0 1 12.5 16.4" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M 19.5 22 L 32 45 L 44.5 22" fill="none" stroke="#FFFFFF" strokeWidth="5.5" strokeLinejoin="miter" strokeLinecap="butt" />
        </symbol>

        <symbol id="i-shield" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9,12 11,14 15,10" /></symbol>
        <symbol id="i-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></symbol>
        <symbol id="i-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></symbol>
        <symbol id="i-star" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" /></symbol>
        <symbol id="i-msg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></symbol>
        <symbol id="i-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13,6 19,12 13,18" /></symbol>
        <symbol id="i-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12" /></symbol>
        <symbol id="i-broom" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M19.36 2.72l1.42 1.42-9.19 9.19-1.42-1.42z" /><path d="M11.59 13.33L7 18l-5 1 1-5 4.67-4.59" /><path d="M3 21h18" /></symbol>
        <symbol id="i-truck" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16,8 20,8 23,11 23,16 16,16" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></symbol>
        <symbol id="i-wrench" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></symbol>
        <symbol id="i-package" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12.89 1.45l8 4A2 2 0 0 1 22 7.24v9.53a2 2 0 0 1-1.11 1.79l-8 4a2 2 0 0 1-1.79 0l-8-4a2 2 0 0 1-1.1-1.8V7.24a2 2 0 0 1 1.11-1.79l8-4a2 2 0 0 1 1.78 0z" /><polyline points="2.32,6.16 12,11 21.68,6.16" /><line x1="12" y1="22.76" x2="12" y2="11" /></symbol>
        <symbol id="i-bolt" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10" /></symbol>
        <symbol id="i-paw" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="5.5" cy="9.5" r="2" /><circle cx="18.5" cy="9.5" r="2" /><circle cx="9" cy="4.5" r="2" /><circle cx="15" cy="4.5" r="2" /><path d="M8 14c-2 0-3.5 1.5-3.5 3.5S6 21 8 21h8c2 0 3.5-1.5 3.5-3.5S18 14 16 14z" /></symbol>
        <symbol id="i-leaf" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M11 20A7 7 0 0 1 4 13C4 6 14 3 20 4c1 6-2 16-9 16z" /><path d="M2 22c4-2 7-4 10-10" /></symbol>
        <symbol id="i-laptop" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="12" rx="2" /><line x1="2" y1="20" x2="22" y2="20" /></symbol>
        <symbol id="i-spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></symbol>
        <symbol id="i-book" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></symbol>
        <symbol id="i-cal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></symbol>
        <symbol id="i-grid" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></symbol>
      </defs>
    </svg>
  );
}
