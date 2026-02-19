---
name: glassmorphism-design
description: Teaches Claude to produce production-quality glassmorphism UI — frosted-glass cards, layered blur effects, translucent panels, and luminous glows — for HTML, React/JSX, and CSS outputs. Use when the user requests glass, frosted, blur, or translucent UI aesthetics.
---

# Glassmorphism Design Skill

Glassmorphism is a UI design trend that mimics frosted glass: translucent surfaces, background blur, subtle borders, and soft glows — layered over vivid gradients or imagery to create depth and luminosity.

When this skill is active, Claude must produce stunning, production-grade glassmorphism UI — not generic or flat outputs. Every element should look like it was pulled from a premium macOS or iOS design system.

---

## Core Visual Principles

### 1. The Four Pillars of Glassmorphism

Every glass element MUST have all four:

| Pillar | What It Does | CSS Property |
|--------|-------------|--------------|
| **Translucency** | Semi-transparent fill reveals background | `background: rgba(255,255,255,0.12)` |
| **Blur** | Frosted/diffused background | `backdrop-filter: blur(20px)` |
| **Border** | Thin luminous edge catches light | `border: 1px solid rgba(255,255,255,0.25)` |
| **Shadow** | Depth and lift from surface | `box-shadow: 0 8px 32px rgba(0,0,0,0.3)` |

**Without all four, it is NOT glassmorphism.**

---

## Backgrounds: The Foundation

Glass only looks good over rich backgrounds. Never place glass on white or flat gray.

### Recommended Background Patterns

**Gradient Orbs (most popular)**

```css
body {
  min-height: 100vh;
  background: #0a0a1a;
  position: relative;
  overflow: hidden;
}

/* Colorful blurred orbs behind everything */
body::before {
  content: '';
  position: fixed;
  width: 600px;
  height: 600px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(120, 40, 200, 0.6), transparent 70%);
  top: -200px;
  left: -100px;
  filter: blur(80px);
  z-index: 0;
}

body::after {
  content: '';
  position: fixed;
  width: 500px;
  height: 500px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(20, 120, 255, 0.5), transparent 70%);
  bottom: -150px;
  right: -50px;
  filter: blur(80px);
  z-index: 0;
}
```

**Mesh Gradient**

```css
background: linear-gradient(135deg, 
  #667eea 0%, 
  #764ba2 30%, 
  #f093fb 60%, 
  #4facfe 100%
);
```

**Dark Aurora**

```css
background: 
  radial-gradient(ellipse at 20% 50%, rgba(120, 40, 200, 0.4) 0%, transparent 50%),
  radial-gradient(ellipse at 80% 20%, rgba(20, 200, 180, 0.3) 0%, transparent 50%),
  radial-gradient(ellipse at 50% 80%, rgba(255, 100, 50, 0.3) 0%, transparent 50%),
  #0d0d1a;
```

---

## Glass Surface Recipes

### Standard Glass Card

```css
.glass-card {
  background: rgba(255, 255, 255, 0.10);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.20);
  border-radius: 20px;
  box-shadow: 
    0 8px 32px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
  padding: 32px;
}
```

### Frosted Dark Glass (premium look)

```css
.glass-dark {
  background: rgba(10, 10, 30, 0.55);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  box-shadow: 
    0 20px 60px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.10),
    inset 0 -1px 0 rgba(0, 0, 0, 0.20);
}
```

### Colored Glass (tinted panels)

```css
.glass-purple {
  background: rgba(120, 40, 200, 0.15);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(180, 100, 255, 0.25);
  border-radius: 16px;
  box-shadow: 
    0 8px 32px rgba(80, 0, 160, 0.3),
    0 0 60px rgba(120, 40, 200, 0.1);
}
```

### Glass Navbar

```css
.glass-nav {
  background: rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  position: sticky;
  top: 0;
  z-index: 100;
  padding: 16px 32px;
}
```

---

## Typography on Glass

Text must be legible on translucent surfaces. Use these techniques:

```css
/* Primary headings — bright white */
h1, h2 {
  color: #ffffff;
  font-weight: 700;
  text-shadow: 0 2px 20px rgba(0, 0, 0, 0.3);
  letter-spacing: -0.02em;
}

/* Body text — slightly muted white */
p {
  color: rgba(255, 255, 255, 0.75);
  line-height: 1.6;
}

/* Labels, captions */
.label {
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

/* Accent / gradient text */
.gradient-text {
  background: linear-gradient(135deg, #a78bfa, #60a5fa);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

---

## Interactive Elements

### Glass Button

```css
.btn-glass {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 12px;
  color: #fff;
  padding: 12px 28px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  letter-spacing: 0.02em;
}

.btn-glass:hover {
  background: rgba(255, 255, 255, 0.25);
  border-color: rgba(255, 255, 255, 0.4);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  transform: translateY(-2px);
}

.btn-glass:active {
  transform: translateY(0);
}
```

### Glow Button (primary CTA)

```css
.btn-glow {
  background: linear-gradient(135deg, rgba(120, 80, 255, 0.8), rgba(60, 180, 255, 0.8));
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 12px;
  color: #fff;
  padding: 12px 32px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 
    0 0 20px rgba(120, 80, 255, 0.4),
    0 4px 16px rgba(0, 0, 0, 0.2);
  transition: all 0.2s ease;
}

.btn-glow:hover {
  box-shadow: 
    0 0 40px rgba(120, 80, 255, 0.6),
    0 8px 24px rgba(0, 0, 0, 0.3);
  transform: translateY(-2px);
}
```

### Glass Input Field

```css
.input-glass {
  background: rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  color: #fff;
  padding: 12px 16px;
  font-size: 1rem;
  outline: none;
  width: 100%;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.input-glass::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

.input-glass:focus {
  border-color: rgba(120, 80, 255, 0.6);
  box-shadow: 0 0 0 3px rgba(120, 80, 255, 0.15);
}
```

---

## Depth & Layering

Glassmorphism achieves depth by stacking multiple glass layers. Each layer should have:

- Slightly different opacity
- Slightly different blur value
- Correct z-index ordering

```
Layer 0: Background (vivid gradient, full opacity)
Layer 1: Base glass panel (blur: 24px, opacity: 0.08–0.12)
Layer 2: Content card (blur: 16px, opacity: 0.12–0.18)  
Layer 3: UI elements (blur: 8px, opacity: 0.20–0.30)
Layer 4: Tooltips / dropdowns (blur: 12px, opacity: 0.25)
```

---

## Highlight & Gloss Effects

The top edge highlight is what makes glass look truly realistic:

```css
/* Top edge light catch */
.glass-card {
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.3),           /* drop shadow */
    inset 0 1px 0 rgba(255, 255, 255, 0.20),  /* top edge highlight */
    inset 0 -1px 0 rgba(255, 255, 255, 0.05), /* bottom edge */
    inset 1px 0 rgba(255, 255, 255, 0.08),    /* left edge */
    inset -1px 0 rgba(255, 255, 255, 0.08);   /* right edge */
}

/* Glossy top sheen */
.glass-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.4) 30%,
    rgba(255, 255, 255, 0.6) 50%,
    rgba(255, 255, 255, 0.4) 70%,
    transparent
  );
  border-radius: 20px 20px 0 0;
}
```

---

## Animations

Glass elements should feel alive and fluid:

```css
/* Entry animation */
@keyframes glassReveal {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.97);
    backdrop-filter: blur(0px);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
    backdrop-filter: blur(20px);
  }
}

.glass-card {
  animation: glassReveal 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

/* Floating orb animation */
@keyframes floatOrb {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33%       { transform: translate(30px, -30px) scale(1.05); }
  66%       { transform: translate(-20px, 20px) scale(0.97); }
}

.orb {
  animation: floatOrb 8s ease-in-out infinite;
}

/* Shimmer / aurora sweep */
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.shimmer {
  background: linear-gradient(
    90deg,
    transparent 25%,
    rgba(255,255,255,0.15) 50%,
    transparent 75%
  );
  background-size: 200% 100%;
  animation: shimmer 2s infinite;
}
```

---

## React/JSX Implementation

When writing React components, use inline styles or Tailwind. Always include `-webkit-backdrop-filter` for Safari support.

### Tailwind + Custom CSS Pattern

```jsx
// Glass Card Component
const GlassCard = ({ children, className = '' }) => (
  <div
    className={`rounded-2xl p-8 ${className}`}
    style={{
      background: 'rgba(255, 255, 255, 0.10)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid rgba(255, 255, 255, 0.20)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.15)',
    }}
  >
    {children}
  </div>
);
```

### Full Page Background Pattern in React

```jsx
const GlassPage = () => (
  <div style={{ 
    minHeight: '100vh', 
    background: '#0a0a1a',
    position: 'relative',
    overflow: 'hidden'
  }}>
    {/* Background orbs */}
    <div style={{
      position: 'fixed', width: 600, height: 600, borderRadius: '50%',
      background: 'radial-gradient(circle, rgba(120,40,200,0.5), transparent 70%)',
      top: -200, left: -100, filter: 'blur(80px)', zIndex: 0
    }} />
    <div style={{
      position: 'fixed', width: 500, height: 500, borderRadius: '50%',
      background: 'radial-gradient(circle, rgba(20,120,255,0.4), transparent 70%)',
      bottom: -150, right: -50, filter: 'blur(80px)', zIndex: 0
    }} />
    
    {/* Content */}
    <div style={{ position: 'relative', zIndex: 1 }}>
      {/* Glass cards go here */}
    </div>
  </div>
);
```

---

## Common Mistakes to Avoid

| ❌ Wrong | ✅ Right |
|---------|---------|
| Glass on white/light background | Glass over vivid gradients or dark backgrounds |
| `opacity: 0.3` on the whole element | `background: rgba(...)` only for translucency |
| Forgetting `-webkit-backdrop-filter` | Always include both vendor-prefixed and standard |
| Blur radius under 8px | Use 16–24px for realistic frosted glass |
| No border | Always include a subtle white border |
| Too many glowing elements competing | 1–2 dominant glow colors, rest neutral |
| Unreadable text on glass | Use white text with `text-shadow` for legibility |
| Flat, static glass | Add hover transitions and entry animations |

---

## Design System Values

Use these tokens for consistency across glassmorphism UIs:

```css
:root {
  /* Glass surfaces */
  --glass-white:      rgba(255, 255, 255, 0.10);
  --glass-white-md:   rgba(255, 255, 255, 0.18);
  --glass-dark:       rgba(10, 10, 30, 0.50);
  
  /* Borders */
  --glass-border:     rgba(255, 255, 255, 0.18);
  --glass-border-sm:  rgba(255, 255, 255, 0.10);
  
  /* Blur */
  --blur-sm:   blur(8px);
  --blur-md:   blur(16px);
  --blur-lg:   blur(24px);
  --blur-xl:   blur(40px);
  
  /* Shadows */
  --shadow-glass: 0 8px 32px rgba(0, 0, 0, 0.3);
  --shadow-float: 0 20px 60px rgba(0, 0, 0, 0.5);
  
  /* Accent glows */
  --glow-purple: rgba(120, 40, 200, 0.4);
  --glow-blue:   rgba(20, 120, 255, 0.4);
  --glow-pink:   rgba(255, 60, 180, 0.4);
  --glow-teal:   rgba(20, 200, 180, 0.4);
  
  /* Border radius */
  --radius-card: 20px;
  --radius-btn:  12px;
  --radius-pill: 999px;
}
```

---

## Output Checklist

Before finishing any glassmorphism output, verify:

- [ ] Background is vivid (gradient, orbs, or image) — NOT flat or white
- [ ] All glass elements have `backdrop-filter` AND `-webkit-backdrop-filter`
- [ ] Borders are present on all glass elements (subtle white RGBA)
- [ ] Text is legible (white or near-white with appropriate opacity)
- [ ] Hover states exist for interactive elements (buttons, cards, inputs)
- [ ] At least one entry animation or transition is present
- [ ] Inset top-edge highlight adds gloss realism
- [ ] No competing visual noise — hierarchy is clear
- [ ] z-index layering is correct (background → glass → content)
- [ ] Cross-browser: `-webkit-backdrop-filter` included

---

## Quick Reference: Glassmorphism Formulas

| Element | Background | Blur | Border | Shadow |
|---------|-----------|------|--------|--------|
| Primary card | `rgba(255,255,255,0.10)` | `blur(20px)` | `rgba(255,255,255,0.20)` | `0 8px 32px rgba(0,0,0,0.3)` |
| Dark panel | `rgba(10,10,30,0.55)` | `blur(24px)` | `rgba(255,255,255,0.12)` | `0 20px 60px rgba(0,0,0,0.5)` |
| Navbar | `rgba(255,255,255,0.07)` | `blur(20px)` | `rgba(255,255,255,0.12)` (bottom) | — |
| Button | `rgba(255,255,255,0.15)` | `blur(10px)` | `rgba(255,255,255,0.25)` | `0 4px 16px rgba(0,0,0,0.2)` |
| Input | `rgba(255,255,255,0.07)` | `blur(10px)` | `rgba(255,255,255,0.15)` | — |
| Modal | `rgba(15,15,40,0.65)` | `blur(32px)` | `rgba(255,255,255,0.15)` | `0 25px 80px rgba(0,0,0,0.6)` |
| Tooltip | `rgba(30,30,60,0.80)` | `blur(12px)` | `rgba(255,255,255,0.15)` | `0 4px 16px rgba(0,0,0,0.4)` |
