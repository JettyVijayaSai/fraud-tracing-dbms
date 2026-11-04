/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        darkbg: "#0B0F19",
        cardbg: "#111827",
        bordercolor: "#1F2937",
        accent: "#3B82F6",
        crimson: "#EF4444",
        emerald: "#10B981",
        amber: "#F59E0B"
      }
    },
  },
  plugins: [],
}
