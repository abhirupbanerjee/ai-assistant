import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
      },
    },
  },
  plugins: [
    plugin(function ({ addVariant }) {
      // Add data-state variants for adaptive input bar
      addVariant('data-state-compact', '&[data-state="compact"]');
      addVariant('data-state-expanded', '&[data-state="expanded"]');
      addVariant('data-state-focused-write', '&[data-state="focused-write"]');
    }),
  ],
};

export default config;
