/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Landing (monochrome HUD) tokens, defined as CSS variables in styles/index.css
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        elevated: 'var(--elevated)',
        line: 'var(--border)',
        'line-strong': 'var(--border-strong)',
        ink: 'var(--text)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        warm: 'var(--accent-warm)',
        blue: 'var(--accent-blue)',
        violet: 'var(--accent-violet)',
        // Workspace tokens (switch with the active workspace theme)
        ws: {
          canvas: 'var(--ws-canvas)',
          // Accent tints (theme accents are CSS variables, so Tailwind's /NN opacity can't apply)
          'accent-soft': 'color-mix(in srgb, var(--ws-accent) 24%, transparent)',
          'accent-strong': 'color-mix(in srgb, var(--ws-accent) 34%, transparent)',
          'accent-line': 'color-mix(in srgb, var(--ws-accent) 60%, transparent)',
          editor: 'var(--ws-editor-bg)',
          panel: 'var(--ws-panel)',
          border: 'var(--ws-border)',
          text: 'var(--ws-text)',
          muted: 'var(--ws-muted)',
          accent: 'var(--ws-accent)',
          selected: 'var(--ws-selected)',
          hover: 'var(--ws-hover)',
          widget: 'var(--ws-widget)',
        },
      },
      fontFamily: {
        display: ['"Inter Tight"', 'Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        code: ['"Fira Code"', '"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        display: '-0.04em',
        hud: '0.12em',
      },
      borderRadius: {
        card: '10px',
        chrome: '6px',
      },
      fontSize: {
        hud: ['11px', { lineHeight: '1.4', letterSpacing: '0.12em' }],
      },
      transitionTimingFunction: {
        synq: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      transitionDuration: {
        micro: '180ms',
        ui: '380ms',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.45', transform: 'scale(0.8)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-6px)' },
          '40%, 80%': { transform: 'translateX(6px)' },
        },
        'glitch-x': {
          '0%, 100%': { transform: 'translate(0, 0)' },
          '20%': { transform: 'translate(-2px, 1px)' },
          '40%': { transform: 'translate(2px, -1px)' },
          '60%': { transform: 'translate(-1px, 0)' },
          '80%': { transform: 'translate(1px, 1px)' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'pulse-dot': 'pulse-dot 1.4s ease-in-out infinite',
        shake: 'shake 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
        'glitch-x': 'glitch-x 0.6s steps(2, end) infinite',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
};
