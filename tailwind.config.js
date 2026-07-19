/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './hooks/**/*.{js,ts,jsx,tsx}',
    './lib/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Vazirmatn', 'IRANSans', 'Tahoma', 'Arial', 'sans-serif'],
        mono: ['Vazirmatn', 'IRANSans', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
