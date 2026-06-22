/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Dynamically-built color classes (e.g. `bg-${color}-50`) can't be detected by
  // the scanner, so safelist the orange variants used by the comparison cards.
  safelist: [
    'bg-orange-50', 'border-orange-200', 'text-orange-700', 'text-orange-800',
    'ring-orange-400', 'ring-orange-200', 'bg-orange-100', 'text-orange-600',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        sidebar: {
          DEFAULT: '#1e293b',
          hover: '#334155',
          active: '#3b82f6',
        },
        brand: {
          DEFAULT: '#3b82f6',
          dark: '#2563eb',
        },
      },
    },
  },
  plugins: [],
}
