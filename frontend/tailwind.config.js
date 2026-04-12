/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
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
