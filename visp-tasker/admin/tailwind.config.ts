import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#7850FF',
        primaryDark: '#4f46e5',
        primaryLight: '#a78bfa',
        background: '#0a0a1e',
        surface: '#16213E',
        glass: 'rgba(255, 255, 255, 0.06)',
        glassBorder: 'rgba(255, 255, 255, 0.12)',
        success: '#27AE60',
        warning: '#F39C12',
        danger: '#E74C3C',
        textPrimary: '#FFFFFF',
        textSecondary: 'rgba(255,255,255,0.55)',
        textTertiary: 'rgba(255,255,255,0.35)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
