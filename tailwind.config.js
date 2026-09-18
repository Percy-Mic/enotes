/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  /* Note: the [data-theme] overrides in globals.css target utility class
     names (bg-white, bg-[#FFF7F8], …) that all appear verbatim in source
     files, so Tailwind already emits them — no safelist needed. */
  theme: {
    extend: {},
  },
  plugins: [],
}