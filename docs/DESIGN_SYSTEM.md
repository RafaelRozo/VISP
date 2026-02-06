# VISP/TASKER Design System

## TaskRabbit × Uber Hybrid Aesthetic

### iOS Mobile App Design Specification

---

# Design Philosophy

```
TASKER DESIGN = TaskRabbit's warmth + Uber's precision
```

- **TaskRabbit Influence**: Warm colors, friendly profiles, trust-forward badges
- **Uber Influence**: Clean minimalism, real-time tracking, status-driven UI

---

# 1. Color System

## 1.1 Core Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | `#2D3436` | Headers, primary text, navigation |
| `secondary` | `#00B894` | Trust indicators, confirmations, badges |
| `accent` | `#E17055` | CTAs, highlights, warm accents |
| `emergency` | `#E74C3C` | Emergency button, alerts, warnings |
| `background` | `#F8F9FA` | Page backgrounds |
| `surface` | `#FFFFFF` | Cards, modals, inputs |
| `muted` | `#636E72` | Secondary text, placeholders |
| `border` | `#DFE6E9` | Dividers, input borders |

## 1.2 Level Colors

| Level | Color | Badge Style |
|-------|-------|-------------|
| L1 Helper | `#74B9FF` | Blue, friendly |
| L2 Experienced | `#A29BFE` | Purple, skilled |
| L3 Certified | `#00B894` | Green, professional |
| L4 Emergency | `#E74C3C` | Red, urgent |

## 1.3 Semantic Colors

```typescript
const semanticColors = {
  success: '#00B894',
  warning: '#FDCB6E',
  error: '#E74C3C',
  info: '#74B9FF',
  
  // Status-specific
  statusActive: '#00B894',
  statusPending: '#FDCB6E',
  statusCompleted: '#636E72',
  statusCancelled: '#E74C3C',
}
```

## 1.4 Dark Mode (Optional)

```typescript
const darkPalette = {
  primary: '#FFFFFF',
  secondary: '#00B894',
  accent: '#E17055',
  background: '#1A1A2E',
  surface: '#16213E',
  muted: '#A0A0A0',
  border: '#2A2A4A',
}
```

---

# 2. Typography

## 2.1 Font Family

```typescript
const fonts = {
  primary: 'Inter',      // Body text, UI elements
  heading: 'Inter',      // Headers (same family, different weight)
  mono: 'SF Mono',       // Prices, codes, technical info
}
```

**iOS Fallback**: SF Pro Display, SF Pro Text

## 2.2 Type Scale

| Token | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| `h1` | 32px | 700 | 1.2 | Screen titles |
| `h2` | 24px | 600 | 1.3 | Section headers |
| `h3` | 18px | 600 | 1.4 | Card titles |
| `body` | 16px | 400 | 1.5 | Body text |
| `bodySmall` | 14px | 400 | 1.5 | Secondary text |
| `caption` | 12px | 400 | 1.4 | Labels, timestamps |
| `button` | 16px | 600 | 1 | Button labels |
| `price` | 24px | 700 | 1 | Prices, totals |

## 2.3 Implementation

```typescript
const typography = {
  h1: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: colors.primary,
  },
  body: {
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
    color: colors.primary,
  },
  // ... etc
}
```

---

# 3. Spacing System

## 3.1 Base Scale

```typescript
const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
}
```

## 3.2 Component Spacing

| Context | Spacing | Token |
|---------|---------|-------|
| Card padding | 16px | `lg` |
| Section gap | 24px | `xl` |
| List item gap | 12px | `md` |
| Button padding | 12px/24px | `md`/`xl` |
| Input padding | 12px/16px | `md`/`lg` |
| Screen horizontal | 16px | `lg` |
| Screen vertical | 24px | `xl` |

---

# 4. Component Library

## 4.1 Buttons

### Primary Button (CTA)

```typescript
const PrimaryButton = {
  backgroundColor: colors.accent,   // Warm coral
  borderRadius: 12,
  paddingVertical: 14,
  paddingHorizontal: 24,
  
  // Text
  color: '#FFFFFF',
  fontSize: 16,
  fontWeight: '600',
  
  // States
  pressed: { opacity: 0.9 },
  disabled: { opacity: 0.5 },
}
```

### Emergency Button

```typescript
const EmergencyButton = {
  backgroundColor: colors.emergency,
  borderRadius: 16,
  paddingVertical: 20,
  paddingHorizontal: 32,
  
  // Pulsing animation
  animation: 'pulse',
  shadowColor: colors.emergency,
  shadowOpacity: 0.4,
  shadowRadius: 20,
}
```

### Secondary Button

```typescript
const SecondaryButton = {
  backgroundColor: 'transparent',
  borderWidth: 1.5,
  borderColor: colors.accent,
  borderRadius: 12,
  color: colors.accent,
}
```

### Ghost Button

```typescript
const GhostButton = {
  backgroundColor: 'transparent',
  color: colors.muted,
  paddingVertical: 8,
}
```

## 4.2 Cards

### Service Card

```typescript
const ServiceCard = {
  backgroundColor: colors.surface,
  borderRadius: 16,
  padding: 16,
  
  // Shadow (subtle)
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 8,
  
  // iOS elevation alternative
  elevation: 2,
}
```

### Provider Card

```typescript
const ProviderCard = {
  ...ServiceCard,
  flexDirection: 'row',
  alignItems: 'center',
  
  // Avatar
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  
  // Badge position
  badgePosition: 'bottom-right',
}
```

### Emergency Card (Selection)

```typescript
const EmergencyCard = {
  backgroundColor: colors.surface,
  borderRadius: 20,
  borderWidth: 2,
  borderColor: 'transparent',
  height: 120,
  
  // Selected state
  selected: {
    borderColor: colors.emergency,
    backgroundColor: '#FDF2F2',
  },
  
  // Icon
  iconSize: 32,
  iconColor: colors.emergency,
}
```

## 4.3 Badges

### Level Badge

```typescript
const LevelBadge = {
  L1: { backgroundColor: '#74B9FF20', color: '#74B9FF', label: 'Helper' },
  L2: { backgroundColor: '#A29BFE20', color: '#A29BFE', label: 'Experienced' },
  L3: { backgroundColor: '#00B89420', color: '#00B894', label: 'Certified' },
  L4: { backgroundColor: '#E74C3C20', color: '#E74C3C', label: 'Emergency' },
  
  borderRadius: 8,
  paddingVertical: 4,
  paddingHorizontal: 8,
  fontSize: 12,
  fontWeight: '600',
}
```

### Verification Badge

```typescript
const VerificationBadge = {
  CRC: { icon: 'shield-check', label: 'Verified CRC' },
  CRJMC: { icon: 'shield-star', label: 'Enhanced' },
  VSC: { icon: 'shield-heart', label: 'Vulnerable Sector' },
  
  backgroundColor: colors.secondary + '20',
  color: colors.secondary,
}
```

## 4.4 Inputs

### Text Input

```typescript
const TextInput = {
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 12,
  paddingVertical: 14,
  paddingHorizontal: 16,
  fontSize: 16,
  
  // States
  focused: {
    borderColor: colors.accent,
    borderWidth: 2,
  },
  error: {
    borderColor: colors.error,
  },
}
```

### Phone Input (Special)

```typescript
const PhoneInput = {
  ...TextInput,
  
  // Country code section
  countryCode: {
    width: 72,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
}
```

### Checkbox (Legal)

```typescript
const LegalCheckbox = {
  size: 24,
  borderRadius: 6,
  borderWidth: 2,
  borderColor: colors.muted,
  
  checked: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  
  // Mandatory indicator
  mandatory: {
    labelColor: colors.primary,
    fontWeight: '500',
  },
}
```

## 4.5 Status Indicators

### SLA Timer

```typescript
const SLATimer = {
  backgroundColor: colors.emergency + '10',
  borderRadius: 12,
  padding: 12,
  
  // Time display
  timeStyle: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: fonts.mono,
    color: colors.emergency,
  },
  
  // Label
  labelStyle: {
    fontSize: 12,
    color: colors.muted,
    textTransform: 'uppercase',
  },
}
```

### Status Timeline

```typescript
const StatusTimeline = {
  steps: ['Accepted', 'En Route', 'Arrived', 'In Progress', 'Completed'],
  
  // Step styling
  activeColor: colors.secondary,
  inactiveColor: colors.border,
  completedColor: colors.secondary,
  
  // Connector line
  lineWidth: 2,
  lineStyle: 'dashed', // inactive
}
```

---

# 5. iOS-Specific Guidelines

## 5.1 Safe Areas

```typescript
const screenPadding = {
  top: 'safe-area-inset-top',
  bottom: 'safe-area-inset-bottom',
  horizontal: 16,
}
```

## 5.2 Navigation Bar

```typescript
const NavBar = {
  height: 56,
  backgroundColor: colors.surface,
  
  // Title
  titleStyle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.primary,
  },
  
  // Back button
  backIcon: 'chevron-left',
  backIconSize: 24,
  
  // Border
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
}
```

## 5.3 Tab Bar

```typescript
const TabBar = {
  height: 83, // includes safe area
  backgroundColor: colors.surface,
  
  // Icons
  iconSize: 24,
  activeColor: colors.accent,
  inactiveColor: colors.muted,
  
  // Labels
  showLabels: true,
  labelSize: 10,
  
  // Shadow
  shadowOffset: { width: 0, height: -2 },
  shadowOpacity: 0.05,
}
```

## 5.4 Modal Sheets

```typescript
const ModalSheet = {
  backgroundColor: colors.surface,
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
  
  // Handle indicator
  handleWidth: 36,
  handleHeight: 4,
  handleColor: colors.border,
  handleMarginTop: 8,
  
  // Content padding
  padding: 24,
}
```

## 5.5 Haptic Feedback

| Action | Haptic Type |
|--------|-------------|
| Button press | `impactLight` |
| Toggle switch | `impactMedium` |
| Error | `notificationError` |
| Success | `notificationSuccess` |
| Emergency tap | `impactHeavy` |

---

# 6. Animations & Micro-Interactions

## 6.1 Timing Functions

```typescript
const easing = {
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeIn: 'cubic-bezier(0.55, 0.055, 0.675, 0.19)',
  easeInOut: 'cubic-bezier(0.87, 0, 0.13, 1)',
  spring: { damping: 15, stiffness: 150 },
}
```

## 6.2 Duration Scale

| Token | Duration | Usage |
|-------|----------|-------|
| `fast` | 150ms | Micro-interactions |
| `normal` | 250ms | Most transitions |
| `slow` | 400ms | Page transitions |
| `slower` | 600ms | Complex animations |

## 6.3 Key Animations

### Emergency Button Pulse

```typescript
const emergencyPulse = {
  type: 'loop',
  duration: 2000,
  keyframes: [
    { scale: 1, shadowOpacity: 0.3 },
    { scale: 1.02, shadowOpacity: 0.5 },
    { scale: 1, shadowOpacity: 0.3 },
  ],
}
```

### Provider Arrival Marker

```typescript
const arrivalMarker = {
  type: 'loop',
  duration: 1500,
  keyframes: [
    { scale: 1, opacity: 1 },
    { scale: 1.5, opacity: 0 },
  ],
}
```

### Card Press Feedback

```typescript
const cardPress = {
  duration: 100,
  scale: 0.98,
  opacity: 0.95,
}
```

### Status Step Completion

```typescript
const stepComplete = {
  duration: 300,
  easing: easing.spring,
  keyframes: [
    { scale: 0.8, opacity: 0 },
    { scale: 1.1 },
    { scale: 1, opacity: 1 },
  ],
}
```

### Loading States

```typescript
const loadingSpinner = {
  type: 'rotate',
  duration: 800,
  iteration: 'infinite',
  easing: 'linear',
}

const skeletonPulse = {
  type: 'loop',
  duration: 1500,
  keyframes: [
    { backgroundColor: '#F0F0F0' },
    { backgroundColor: '#E0E0E0' },
    { backgroundColor: '#F0F0F0' },
  ],
}
```

## 6.4 Page Transitions

```typescript
const pageTransitions = {
  push: {
    incoming: { translateX: '100%' → 0 },
    outgoing: { translateX: 0 → '-20%', opacity: 1 → 0.5 },
    duration: 300,
  },
  
  modal: {
    incoming: { translateY: '100%' → 0 },
    outgoing: { opacity: 1 → 0 },
    duration: 350,
  },
  
  fade: {
    incoming: { opacity: 0 → 1 },
    outgoing: { opacity: 1 → 0 },
    duration: 200,
  },
}
```

---

# 7. Icons

## 7.1 Icon Set

**Primary**: SF Symbols (iOS native) or Phosphor Icons

## 7.2 Key Icons

| Purpose | Icon Name |
|---------|-----------|
| Home | `house.fill` |
| Search | `magnifyingglass` |
| Bookings | `calendar` |
| Messages | `message.fill` |
| Profile | `person.fill` |
| Emergency | `exclamationmark.triangle.fill` |
| Location | `location.fill` |
| Call | `phone.fill` |
| Message | `message.fill` |
| Star (rating) | `star.fill` |
| Verified | `checkmark.shield.fill` |
| Clock | `clock.fill` |
| Dollar | `dollarsign.circle.fill` |
| Back | `chevron.left` |
| Forward | `chevron.right` |
| Close | `xmark` |
| More | `ellipsis` |

## 7.3 Icon Sizes

| Context | Size |
|---------|------|
| Tab bar | 24px |
| Navigation | 24px |
| In-card | 20px |
| Inline | 16px |
| Feature icon | 32px |
| Emergency card | 40px |

---

# 8. Accessibility

## 8.1 Color Contrast

All text must meet WCAG AA:

- Normal text: 4.5:1 minimum
- Large text (18px+): 3:1 minimum

## 8.2 Touch Targets

- Minimum: 44x44pt (iOS standard)
- Recommended: 48x48pt for primary actions

## 8.3 VoiceOver Labels

```typescript
// Example accessibility props
<TouchableOpacity
  accessibilityLabel="Request emergency plumber"
  accessibilityRole="button"
  accessibilityHint="Activates emergency service request"
/>
```

## 8.4 Motion Sensitivity

```typescript
// Respect reduce motion preference
const shouldReduceMotion = useReducedMotion();

const animation = shouldReduceMotion 
  ? { duration: 0 } 
  : { duration: 300, easing: easing.spring };
```

---

# 9. Screen Templates

## 9.1 List Screen Template

```
┌────────────────────────────────────┐
│ ← Title                        ... │  ← NavBar
├────────────────────────────────────┤
│ [Search Bar]                       │
├────────────────────────────────────┤
│                                    │
│ ┌──────────────────────────────┐   │
│ │ [Avatar] Name                │   │  ← Card
│ │          Rating ★★★★☆        │   │
│ │          [Badge] [Badge]     │   │
│ └──────────────────────────────┘   │
│                                    │
│ ┌──────────────────────────────┐   │
│ │ ...                          │   │
│ └──────────────────────────────┘   │
│                                    │
└────────────────────────────────────┘
│ 🏠   🔍   📋   💬   👤          │  ← TabBar
└────────────────────────────────────┘
```

## 9.2 Detail Screen Template

```
┌────────────────────────────────────┐
│ ← Title                        ... │
├────────────────────────────────────┤
│ ┌──────────────────────────────┐   │
│ │        [Hero Image/Map]       │   │
│ └──────────────────────────────┘   │
│                                    │
│ Title                              │
│ Subtitle                           │
│                                    │
│ ─────────────────────────────      │
│                                    │
│ Section Header                     │
│ Body text content here...          │
│                                    │
│ ─────────────────────────────      │
│                                    │
│ Section Header                     │
│ [List item]                        │
│ [List item]                        │
│                                    │
└────────────────────────────────────┘
│ ┌──────────────────────────────┐   │
│ │    [Primary CTA Button]       │   │  ← Sticky Footer
│ └──────────────────────────────┘   │
└────────────────────────────────────┘
```

## 9.3 Form Screen Template

```
┌────────────────────────────────────┐
│ ← Title                        ... │
├────────────────────────────────────┤
│                                    │
│ Label                              │
│ ┌──────────────────────────────┐   │
│ │ [Input Field]                │   │
│ └──────────────────────────────┘   │
│                                    │
│ Label                              │
│ ┌──────────────────────────────┐   │
│ │ [Input Field]                │   │
│ └──────────────────────────────┘   │
│                                    │
│ ☐ Checkbox label (optional)        │
│                                    │
│ Helper text or error message       │
│                                    │
│ ┌──────────────────────────────┐   │
│ │    [Submit Button]            │   │
│ └──────────────────────────────┘   │
│                                    │
└────────────────────────────────────┘
```

## 9.4 Emergency Screen Template

```
┌────────────────────────────────────┐
│ ← Emergency                        │
├────────────────────────────────────┤
│                                    │
│   ⚠️ 45:00 SLA Countdown           │  ← Always visible
│                                    │
│ ─────────────────────────────      │
│                                    │
│ [🗺️ Live Map with Provider]       │
│                                    │
│ ─────────────────────────────      │
│                                    │
│ ┌──────────────────────────────┐   │
│ │ [Provider Info Card]          │   │
│ │ ETA: 12 min                   │   │
│ └──────────────────────────────┘   │
│                                    │
│ ┌──────────┐ ┌──────────────┐      │
│ │ 📞 Call  │ │ 💬 Message    │      │
│ └──────────┘ └──────────────┘      │
│                                    │
└────────────────────────────────────┘
```

---

# 10. Component Code Examples

## 10.1 LevelBadge Component

```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

type Level = 'L1' | 'L2' | 'L3' | 'L4';

const levelConfig = {
  L1: { bg: '#74B9FF20', color: '#74B9FF', label: 'Helper' },
  L2: { bg: '#A29BFE20', color: '#A29BFE', label: 'Experienced' },
  L3: { bg: '#00B89420', color: '#00B894', label: 'Certified' },
  L4: { bg: '#E74C3C20', color: '#E74C3C', label: 'Emergency' },
};

export const LevelBadge: React.FC<{ level: Level }> = ({ level }) => {
  const config = levelConfig[level];
  
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Text style={[styles.text, { color: config.color }]}>
        {config.label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
});
```

## 10.2 EmergencyButton Component

```tsx
import React from 'react';
import { TouchableOpacity, Text, StyleSheet, Animated } from 'react-native';
import { useRef, useEffect } from 'react';

export const EmergencyButton: React.FC<{ onPress: () => void }> = ({ onPress }) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.02,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);
  
  return (
    <Animated.View style={[styles.wrapper, { transform: [{ scale: pulseAnim }] }]}>
      <TouchableOpacity 
        style={styles.button} 
        onPress={onPress}
        accessibilityLabel="Request emergency service"
        accessibilityRole="button"
      >
        <Text style={styles.text}>🚨 Emergency Service</Text>
        <Text style={styles.subtext}>Immediate help • SLA guaranteed</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    shadowColor: '#E74C3C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
  },
  button: {
    backgroundColor: '#E74C3C',
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  text: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  subtext: {
    color: '#FFFFFF',
    opacity: 0.9,
    fontSize: 14,
    marginTop: 4,
  },
});
```

## 10.3 SLATimer Component

```tsx
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface SLATimerProps {
  targetMinutes: number;
  startTime: Date;
  onBreach: () => void;
}

export const SLATimer: React.FC<SLATimerProps> = ({ 
  targetMinutes, 
  startTime, 
  onBreach 
}) => {
  const [remaining, setRemaining] = useState<number>(targetMinutes * 60);
  const [breached, setBreached] = useState(false);
  
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
      const newRemaining = (targetMinutes * 60) - elapsed;
      
      if (newRemaining <= 0 && !breached) {
        setBreached(true);
        onBreach();
      }
      
      setRemaining(Math.max(0, newRemaining));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [targetMinutes, startTime, breached, onBreach]);
  
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  
  return (
    <View style={[styles.container, breached && styles.breached]}>
      <Text style={styles.label}>SLA COUNTDOWN</Text>
      <Text style={[styles.time, breached && styles.timeBreached]}>
        {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#E74C3C10',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  breached: {
    backgroundColor: '#E74C3C',
  },
  label: {
    fontSize: 12,
    color: '#636E72',
    fontWeight: '500',
    letterSpacing: 1,
  },
  time: {
    fontSize: 28,
    fontWeight: '700',
    color: '#E74C3C',
    fontFamily: 'SF Mono',
    marginTop: 4,
  },
  timeBreached: {
    color: '#FFFFFF',
  },
});
```

---

**Document Version**: 1.0
**Last Updated**: February 2026
**Purpose**: iOS Design System Reference
**Audience**: UI/UX Designers, Frontend Developers, AI Sub-Agents
