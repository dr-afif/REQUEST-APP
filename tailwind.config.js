/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  safelist: [
    // getShiftBadgeClass — requested (solid fill) styles
    'bg-green-600', 'text-white', 'border-green-700',
    'bg-amber-500', 'border-amber-600',
    'bg-red-600', 'border-red-700',
    'bg-orange-600', 'border-orange-700',
    'bg-blue-600', 'border-blue-700',
    'bg-slate-600', 'border-slate-700',
    // getShiftBadgeClass — assigned (light fill) styles (already static but listed for safety)
    'bg-green-50', 'text-green-800', 'border-green-500',
    'bg-amber-50', 'text-amber-800', 'border-amber-400',
    'bg-red-50', 'text-red-800', 'border-red-500',
    'bg-orange-50', 'text-orange-800', 'border-orange-400',
    'bg-blue-50', 'text-blue-800', 'border-blue-400',
    'bg-slate-50', 'text-slate-700', 'border-slate-300',
    'text-slate-400', 'border-slate-200',
    // Holiday rose highlight classes
    'bg-rose-950', 'text-rose-100', 'ring-rose-900/20', 'text-rose-200',
    'bg-rose-100/60', 'text-rose-800',
    'bg-rose-50/40',
    // Calendar view row-level holiday classes
    'bg-rose-50/60', 'hover:bg-rose-100/50',
    'text-rose-700', 'text-rose-500',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
      },
      boxShadow: {
        soft: '0 10px 30px -12px rgba(20, 40, 80, 0.25)',
      },
    },
  },
  plugins: [],
};
