---
name: animated-svg-pure-code
description: Produces stunning, production-quality animated SVGs using pure SVG code — no canvas, no external libraries, no raster images. Covers SMIL animations, CSS keyframes inside SVG, JS-driven SVG, morphing paths, particle systems, dashoffset drawing effects, and complex multi-element orchestration. Use when the user asks for animated SVG, SVG animation, or motion graphics in SVG format.
---

# Animated SVG Pure Code Skill

Animated SVGs are self-contained, infinitely scalable, resolution-independent motion graphics defined entirely in XML/code. Every animation, every shape, every color lives in the file — no external assets, no canvas fallbacks, no libraries.

When this skill is active, Claude must produce **visually stunning, technically correct, pure-code SVG animations** — not placeholder boxes with wiggles, but genuine motion graphics-quality work.

---

## The Golden Rule

**Pure code means:** Everything lives inside `<svg>...</svg>`. No `<img>` tags, no `<canvas>`, no external JS files, no CDN imports. Inline `<style>` and inline `<script>` are allowed. SMIL `<animate>` elements are the purest form.

---

## SVG Animation Methods — Know When to Use Each

There are three animation systems available inside SVG. Use the right tool for the job.

### Method 1: SMIL (SVG-native animations)

SMIL (Synchronized Multimedia Integration Language) is native SVG animation — no CSS, no JS needed. Most compatible for static SVG files (emails, `<img>` tags, etc.).

**Core SMIL elements:**

| Element | Animates | Key Attributes |
|---------|---------|----------------|
| `<animate>` | Any attribute | `attributeName`, `values`, `dur`, `repeatCount` |
| `<animateTransform>` | `transform` | `type` (translate/rotate/scale/skewX/skewY) |
| `<animateMotion>` | Position along path | `path`, `rotate="auto"` |
| `<set>` | Instant value change | `to`, `begin` |

**SMIL timing system:**

```xml
<!-- Basic: repeat forever -->
<animate dur="2s" repeatCount="indefinite" />

<!-- Begin after 1 second delay -->
<animate begin="1s" dur="2s" repeatCount="indefinite" />

<!-- Chain: begin when another animation ends -->
<animate id="a1" dur="1s" />
<animate begin="a1.end" dur="1s" />

<!-- Begin on click -->
<animate begin="click" dur="0.3s" fill="freeze" />

<!-- Freeze at end value instead of resetting -->
<animate fill="freeze" />

<!-- Smooth easing -->
<animate calcMode="spline" keySplines="0.42 0 0.58 1" keyTimes="0;1" />
```

**Easing with keySplines:**
- Linear: `calcMode="linear"` (default)
- Ease in-out: `calcMode="spline" keySplines="0.42 0 0.58 1"`
- Ease in: `calcMode="spline" keySplines="0.42 0 1 1"`
- Bounce-like: Multiple keyframes with keySplines per segment

---

### Method 2: CSS Animations (inside `<style>`)

CSS keyframes work exactly like in HTML — target SVG elements by class or ID.

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <style>
    @keyframes spin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: 0.6; transform: scale(0.92); }
    }
    
    .gear {
      transform-origin: 100px 100px; /* center of SVG element */
      animation: spin 3s linear infinite;
    }
    
    .dot {
      animation: pulse 1.4s ease-in-out infinite;
    }
    
    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }
  </style>
  
  <circle class="dot" cx="80" cy="100" r="8" fill="#6366f1"/>
  <circle class="dot" cx="100" cy="100" r="8" fill="#6366f1"/>
  <circle class="dot" cx="120" cy="100" r="8" fill="#6366f1"/>
</svg>
```

**CRITICAL CSS-in-SVG gotcha:** `transform-origin` in SVG behaves differently than in HTML. When targeting SVG elements with CSS transforms, use:
```css
/* Method 1: percentage-based origin (relative to element's bounding box) */
transform-origin: 50% 50%;

/* Method 2: explicit coordinates matching the element's visual center */
transform-origin: 100px 100px; /* if element center is at 100,100 in SVG coords */
```

---

### Method 3: JavaScript (inline `<script>`)

Use JS for: complex physics, user interaction, procedural generation, particle systems, data-driven animations.

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <defs>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  
  <g id="particles"></g>
  
  <script><![CDATA[
    const svg = document.querySelector('svg');
    const ns = 'http://www.w3.org/2000/svg';
    const group = document.getElementById('particles');
    
    const particles = Array.from({ length: 40 }, () => {
      const circle = document.createElementNS(ns, 'circle');
      const p = {
        el: circle,
        x: Math.random() * 400,
        y: Math.random() * 300,
        vx: (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.5) * 1.5,
        r: Math.random() * 3 + 1
      };
      circle.setAttribute('r', p.r);
      circle.setAttribute('fill', `hsl(${Math.random()*60 + 220}, 80%, 70%)`);
      circle.setAttribute('filter', 'url(#glow)');
      group.appendChild(circle);
      return p;
    });
    
    function tick() {
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > 400) p.vx *= -1;
        if (p.y < 0 || p.y > 300) p.vy *= -1;
        p.el.setAttribute('cx', p.x);
        p.el.setAttribute('cy', p.y);
      });
      requestAnimationFrame(tick);
    }
    tick();
  ]]></script>
</svg>
```

---

## Signature Techniques

### 1. Stroke Dashoffset Draw-On Effect

The most iconic SVG animation — paths that "draw" themselves:

```xml
<svg viewBox="0 0 400 100" xmlns="http://www.w3.org/2000/svg">
  <style>
    .draw {
      fill: none;
      stroke: #6366f1;
      stroke-width: 2.5;
      stroke-linecap: round;
      stroke-dasharray: 1000;        /* larger than any path length */
      stroke-dashoffset: 1000;       /* starts fully hidden */
      animation: draw 2s cubic-bezier(0.4, 0, 0.2, 1) forwards;
    }
    @keyframes draw {
      to { stroke-dashoffset: 0; }   /* reveals the path */
    }
  </style>
  <path class="draw" d="M 20 50 C 100 10, 200 90, 300 50 S 380 10 390 50"/>
</svg>
```

**Pro tip:** Get the exact path length in JS with `path.getTotalLength()`, then set `stroke-dasharray` and `stroke-dashoffset` to that value.

---

### 2. Path Morphing

Animate between two SVG paths using SMIL `<animate attributeName="d">`:

```xml
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path fill="#f472b6">
    <!-- CRITICAL: Both paths must have identical number of commands and points -->
    <animate
      attributeName="d"
      dur="2s"
      repeatCount="indefinite"
      values="
        M50,10 L90,90 L10,90 Z;
        M50,5 C80,5 95,35 95,50 C95,75 75,95 50,95 C25,95 5,75 5,50 C5,35 20,5 50,5 Z;
        M50,10 L90,90 L10,90 Z
      "
      calcMode="spline"
      keyTimes="0;0.5;1"
      keySplines="0.4 0 0.2 1; 0.4 0 0.2 1"
    />
  </path>
</svg>
```

**Path morphing rules:**
- Both paths MUST have the same number of path commands
- Both paths MUST use the same command types (L→L, C→C, etc.)
- Convert all relative commands to absolute for reliability
- Use a tool like Flubber.js for complex morphs, or hand-craft compatible paths

---

### 3. AnimateMotion — Moving Along a Path

```xml
<svg viewBox="0 0 500 200" xmlns="http://www.w3.org/2000/svg">
  <!-- The track (visible or invisible) -->
  <path id="track" fill="none" stroke="rgba(99,102,241,0.3)" stroke-width="1.5"
    d="M 20,100 C 100,20 200,180 300,100 S 450,20 490,100"/>
  
  <!-- Object that travels the path -->
  <g>
    <circle r="8" fill="#6366f1"/>
    <circle r="4" fill="white"/>
    <animateMotion dur="4s" repeatCount="indefinite" rotate="auto">
      <mpath href="#track"/>
    </animateMotion>
  </g>
</svg>
```

`rotate="auto"` makes the element face its direction of travel. Use `rotate="auto-reverse"` to face backward.

---

### 4. SVG Filters for Visual Effects

Filters are SVG's secret weapon for glow, blur, turbulence, and displacement:

```xml
<defs>
  <!-- Glow effect -->
  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="4" result="blur"/>
    <feMerge>
      <feMergeNode in="blur"/>
      <feMergeNode in="blur"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>
  
  <!-- Drop shadow -->
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="rgba(0,0,0,0.4)"/>
  </filter>
  
  <!-- Turbulence / noise texture -->
  <filter id="turbulence">
    <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" result="noise"/>
    <feDisplacementMap in="SourceGraphic" in2="noise" scale="8" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  
  <!-- Animated turbulence (liquid/fire effect) -->
  <filter id="liquid">
    <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="3" result="noise" seed="2">
      <animate attributeName="baseFrequency" values="0.02;0.05;0.02" dur="8s" repeatCount="indefinite"/>
    </feTurbulence>
    <feDisplacementMap in="SourceGraphic" in2="noise" scale="20"/>
  </filter>
  
  <!-- Blur that animates -->
  <filter id="pulse-blur">
    <feGaussianBlur>
      <animate attributeName="stdDeviation" values="0;8;0" dur="2s" repeatCount="indefinite"/>
    </feGaussianBlur>
  </filter>
</defs>
```

---

### 5. Clip Path Reveal Animations

```xml
<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Animated clip rectangle that expands to reveal content -->
    <clipPath id="reveal">
      <rect x="0" y="0" height="200">
        <animate attributeName="width" from="0" to="400" dur="1.5s" 
                 fill="freeze" calcMode="spline" 
                 keySplines="0.16 1 0.3 1" keyTimes="0;1"/>
      </rect>
    </clipPath>
  </defs>
  
  <g clip-path="url(#reveal)">
    <!-- All content inside reveals from left to right -->
    <rect width="400" height="200" fill="#1e1b4b"/>
    <text x="200" y="120" text-anchor="middle" font-size="48" fill="white">REVEAL</text>
  </g>
</svg>
```

---

### 6. Gradient Animation

```xml
<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" gradientUnits="userSpaceOnUse"
      x1="0" y1="0" x2="400" y2="400">
      <stop offset="0%" stop-color="#6366f1">
        <animate attributeName="stop-color"
          values="#6366f1;#ec4899;#f59e0b;#6366f1"
          dur="4s" repeatCount="indefinite"/>
      </stop>
      <stop offset="100%" stop-color="#ec4899">
        <animate attributeName="stop-color"
          values="#ec4899;#f59e0b;#6366f1;#ec4899"
          dur="4s" repeatCount="indefinite"/>
      </stop>
    </linearGradient>
    
    <radialGradient id="radgrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgba(99,102,241,0.8)"/>
      <stop offset="100%" stop-color="rgba(99,102,241,0)"/>
      <animate attributeName="r" values="30%;60%;30%" dur="3s" repeatCount="indefinite"/>
    </radialGradient>
  </defs>
  
  <rect width="400" height="400" fill="url(#grad)"/>
  <circle cx="200" cy="200" r="150" fill="url(#radgrad)"/>
</svg>
```

---

### 7. Staggered Multi-Element Orchestration

Create complex choreography using delay chaining:

```xml
<svg viewBox="0 0 300 100" xmlns="http://www.w3.org/2000/svg">
  <style>
    .bar {
      animation: rise 1s cubic-bezier(0.34, 1.56, 0.64, 1) both;
      transform-origin: bottom;
    }
    @keyframes rise {
      from { transform: scaleY(0); opacity: 0; }
      to   { transform: scaleY(1); opacity: 1; }
    }
    /* Stagger each bar */
    .bar:nth-child(1) { animation-delay: 0.0s; }
    .bar:nth-child(2) { animation-delay: 0.1s; }
    .bar:nth-child(3) { animation-delay: 0.2s; }
    .bar:nth-child(4) { animation-delay: 0.3s; }
    .bar:nth-child(5) { animation-delay: 0.4s; }
  </style>
  
  <rect class="bar" x="20"  y="30" width="30" height="60" fill="#6366f1" rx="4"/>
  <rect class="bar" x="70"  y="10" width="30" height="80" fill="#818cf8" rx="4"/>
  <rect class="bar" x="120" y="50" width="30" height="40" fill="#a5b4fc" rx="4"/>
  <rect class="bar" x="170" y="20" width="30" height="70" fill="#818cf8" rx="4"/>
  <rect class="bar" x="220" y="40" width="30" height="50" fill="#6366f1" rx="4"/>
</svg>
```

---

### 8. Particle System (Pure SVG/JS)

```xml
<svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg"
     style="background:#0a0a1a">
  <defs>
    <radialGradient id="pg">
      <stop offset="0%" stop-color="white"/>
      <stop offset="100%" stop-color="white" stop-opacity="0"/>
    </radialGradient>
    <circle id="p" r="2" fill="url(#pg)"/>
  </defs>
  <g id="field"/>
  
  <script><![CDATA[
    const ns = 'http://www.w3.org/2000/svg';
    const field = document.getElementById('field');
    const W = 600, H = 400;
    
    const particles = Array.from({ length: 80 }, () => {
      const use = document.createElementNS(ns, 'use');
      use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#p');
      const state = {
        el: use,
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.8,
        vy: (Math.random() - 0.5) * 0.8,
        life: Math.random(),
        speed: Math.random() * 0.005 + 0.003
      };
      const hue = Math.floor(Math.random() * 60) + 220;
      use.setAttribute('style', `color: hsl(${hue}, 90%, 75%)`);
      field.appendChild(use);
      return state;
    });
    
    // Draw connection lines between nearby particles
    const lines = document.createElementNS(ns, 'g');
    field.insertBefore(lines, field.firstChild);
    
    function frame() {
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        p.life += p.speed;
        if (p.x < 0) p.x = W;
        if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H;
        if (p.y > H) p.y = 0;
        const scale = 0.5 + Math.sin(p.life) * 0.5;
        p.el.setAttribute('transform', `translate(${p.x},${p.y}) scale(${scale + 1})`);
        p.el.setAttribute('opacity', scale * 0.8 + 0.2);
      });
      
      // Update connection lines
      while (lines.firstChild) lines.removeChild(lines.firstChild);
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < 80) {
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', particles[i].x); line.setAttribute('y1', particles[i].y);
            line.setAttribute('x2', particles[j].x); line.setAttribute('y2', particles[j].y);
            line.setAttribute('stroke', 'rgba(150,130,255,' + (1 - dist/80) * 0.3 + ')');
            line.setAttribute('stroke-width', '0.5');
            lines.appendChild(line);
          }
        }
      }
      requestAnimationFrame(frame);
    }
    frame();
  ]]></script>
</svg>
```

---

## Structural Best Practices

### Always Use `<defs>` for Reusables

```xml
<defs>
  <!-- Gradients, filters, clipPaths, markers, patterns, symbols all go here -->
  <!-- Referenced by id elsewhere in the file -->
</defs>
```

### SVG Document Structure

```xml
<svg
  xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink"  <!-- needed for <use> and <mpath> -->
  viewBox="0 0 [width] [height]"               <!-- always use viewBox, not width/height -->
  style="display:block"                         <!-- prevent inline baseline gap -->
>
```

### Groups and Transforms

```xml
<!-- Group elements for collective transform/animation -->
<g id="logo" transform="translate(200 150)">
  <!-- All children move together -->
  <!-- Animate the group, not each child -->
  <animateTransform attributeName="transform" type="translate"
    values="200 150; 200 130; 200 150" dur="2s" repeatCount="indefinite"
    calcMode="spline" keySplines="0.4 0 0.2 1; 0.4 0 0.2 1" keyTimes="0;0.5;1"/>
</g>
```

---

## Performance Rules

| Rule | Why |
|------|-----|
| Animate `opacity` and `transform` only when possible | GPU-composited, no layout recalc |
| Avoid animating `width`, `height`, `x`, `y` in CSS | Triggers SVG layout reflow |
| Use `will-change: transform` sparingly | Only on elements with complex CSS animations |
| Limit filter animations | `feGaussianBlur` on large areas is expensive |
| Use `<use>` to reuse shapes | Reduces DOM size for repeated elements |
| Prefer SMIL for simple animations | Zero JS overhead |
| Use `calcMode="spline"` over JS easing | Native performance |
| Avoid too many JS-driven particles (>200) | Profile on mobile |

---

## Color & Aesthetics for SVGs

SVGs have their own aesthetic language — embrace it:

```xml
<!-- Vivid, saturated colors — SVGs can punch -->
fill="#6366f1"          <!-- Indigo -->
fill="#ec4899"          <!-- Pink -->
fill="#10b981"          <!-- Emerald -->
fill="#f59e0b"          <!-- Amber -->
fill="#06b6d4"          <!-- Cyan -->

<!-- Semi-transparent fills for layering -->
fill="rgba(99, 102, 241, 0.2)"
fill="hsla(250, 80%, 60%, 0.4)"

<!-- Stroke-only (elegant, minimal) -->
fill="none" stroke="#6366f1" stroke-width="1.5"

<!-- White on dark background -->
<svg style="background:#0f0f1a">
  <!-- Elements in white, lavender, or soft colors -->
</svg>

<!-- currentColor for theming -->
fill="currentColor"   <!-- inherits CSS color property -->
```

---

## Typography in SVG

```xml
<!-- Embed Google Fonts -->
<defs>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&amp;display=swap');
  </style>
</defs>

<!-- Basic text -->
<text
  x="200" y="100"
  text-anchor="middle"     <!-- left | middle | right -->
  dominant-baseline="middle"  <!-- visual vertical centering -->
  font-family="Space Grotesk, sans-serif"
  font-size="36"
  font-weight="700"
  fill="white"
  letter-spacing="2"
>
  Hello
</text>

<!-- Text along a path -->
<path id="arc" fill="none" d="M 50,150 A 100,100 0 0,1 350,150"/>
<text>
  <textPath href="#arc" startOffset="50%" text-anchor="middle"
    font-family="sans-serif" font-size="16" fill="#6366f1">
    Text curves along this arc
  </textPath>
</text>
```

---

## Complete Animation Patterns

### Loading Spinner (pure SMIL)
```xml
<svg viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">
  <circle cx="25" cy="25" r="20" fill="none" stroke="#6366f1" stroke-width="3"
    stroke-dasharray="31.4 94.2" stroke-linecap="round">
    <animateTransform attributeName="transform" type="rotate"
      from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"/>
    <animate attributeName="stroke-dasharray"
      values="0 125.6;62.8 62.8;0 125.6" dur="1.5s" repeatCount="indefinite"/>
    <animate attributeName="stroke-dashoffset"
      values="0;-62.8;-125.6" dur="1.5s" repeatCount="indefinite"/>
  </circle>
</svg>
```

### Heartbeat / Pulse Ring
```xml
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="50" r="20" fill="#ec4899"/>
  <!-- Expanding ring -->
  <circle cx="50" cy="50" r="20" fill="none" stroke="#ec4899" stroke-width="2">
    <animate attributeName="r" values="20;45" dur="1.5s" repeatCount="indefinite"/>
    <animate attributeName="stroke-width" values="3;0" dur="1.5s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.8;0" dur="1.5s" repeatCount="indefinite"/>
  </circle>
  <!-- Second ring, offset -->
  <circle cx="50" cy="50" r="20" fill="none" stroke="#ec4899" stroke-width="2">
    <animate attributeName="r" values="20;45" dur="1.5s" begin="0.5s" repeatCount="indefinite"/>
    <animate attributeName="stroke-width" values="3;0" dur="1.5s" begin="0.5s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.8;0" dur="1.5s" begin="0.5s" repeatCount="indefinite"/>
  </circle>
</svg>
```

### Morphing Blob
```xml
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <path fill="#6366f1" transform="translate(100,100)">
    <animate attributeName="d" dur="6s" repeatCount="indefinite"
      calcMode="spline" keyTimes="0;0.33;0.66;1"
      keySplines="0.4 0 0.2 1;0.4 0 0.2 1;0.4 0 0.2 1"
      values="
        M60,-30 C90,0 90,30 60,60 C30,90 -30,90 -60,60 C-90,30 -90,-30 -60,-60 C-30,-90 30,-90 60,-30Z;
        M40,-60 C80,-20 100,30 70,70 C40,110 -20,100 -60,70 C-100,40 -80,-30 -50,-60 C-20,-90 0,-100 40,-60Z;
        M70,0 C100,40 80,90 40,100 C0,110 -50,80 -70,40 C-90,0 -80,-50 -40,-70 C0,-90 40,-40 70,0Z;
        M60,-30 C90,0 90,30 60,60 C30,90 -30,90 -60,60 C-90,30 -90,-30 -60,-60 C-30,-90 30,-90 60,-30Z
      "
    />
  </path>
</svg>
```

---

## Common Mistakes to Avoid

| ❌ Wrong | ✅ Right |
|---------|---------|
| Using pixel `width`/`height` instead of `viewBox` | Always use `viewBox="0 0 W H"` |
| Forgetting `xmlns="http://www.w3.org/2000/svg"` | Required on root `<svg>` element |
| Mismatched path point counts in morphs | Both paths need identical command structure |
| CSS `transform-origin` at `50% 50%` on SVG elements | Set explicitly to element's center coordinates |
| Animating expensive properties (filter blur) on many elements | Limit to 1–3 elements max |
| Hardcoding colors instead of using gradients | Use `<linearGradient>` / `<radialGradient>` |
| `<script>` without `<![CDATA[` wrapper | Use CDATA to avoid XML escape issues |
| Forgetting `xmlns:xlink` when using `<use href>` | Add to root svg element |
| Static, boring backgrounds | SVGs support `<rect fill="url(#grad)"/>` backgrounds |
| Single animation with no choreography | Stagger, chain, and layer multiple animations |

---

## Output Checklist

Before finishing any animated SVG, verify:

- [ ] Root `<svg>` has `xmlns` and `viewBox` (never static width/height alone)
- [ ] All reusable assets (`gradients`, `filters`, `clipPaths`) are in `<defs>`
- [ ] Every SMIL `<animate>` is nested inside the element it targets, OR has an `href`/`xlink:href` pointing to a target
- [ ] `repeatCount="indefinite"` set on all looping animations
- [ ] Easing is intentional — at least one `calcMode="spline"` or CSS cubic-bezier
- [ ] Background is not plain white — use a gradient, dark fill, or atmosphere
- [ ] Multiple elements are animated, not just one
- [ ] Stagger/delay creates visual interest and flow
- [ ] No external dependencies — everything is self-contained
- [ ] `<![CDATA[...]]>` wraps any `<script>` content
- [ ] `fill="freeze"` used on animations that should hold their end state
- [ ] Visual hierarchy is clear — most important element draws the eye first

---

## Quick Reference: Animation Attribute Cheatsheet

```xml
<!-- Timing -->
dur="2s"                          <!-- Duration -->
begin="1s"                        <!-- Delay before start -->
begin="anim-id.end + 0.2s"       <!-- Start after another ends -->
repeatCount="indefinite"          <!-- Loop forever -->
repeatCount="3"                   <!-- Loop 3 times -->
fill="freeze"                     <!-- Hold end state -->
fill="remove"                     <!-- Snap back to start (default) -->

<!-- Values -->
from="0" to="100"                 <!-- Simple A→B -->
values="0;50;100"                 <!-- Multi-step -->
by="10"                           <!-- Relative offset -->

<!-- Easing -->
calcMode="discrete"               <!-- Jump (no interpolation) -->
calcMode="linear"                 <!-- Linear (default for most) -->
calcMode="paced"                  <!-- Constant speed (for motion) -->
calcMode="spline"                 <!-- Custom bezier (most expressive) -->
keyTimes="0;0.5;1"               <!-- Time distribution (required for spline) -->
keySplines="0.4 0 0.2 1; 0.4 0 0.2 1"  <!-- Per-segment bezier control points -->

<!-- Transform types -->
<animateTransform type="translate" from="0 0" to="100 50"/>
<animateTransform type="rotate"    from="0 cx cy" to="360 cx cy"/>
<animateTransform type="scale"     from="1" to="1.5"/>
<animateTransform type="skewX"     from="0" to="20"/>

<!-- Additive transforms (stack with existing transform) -->
additive="sum"                    <!-- Adds to existing transform instead of replacing -->
```
