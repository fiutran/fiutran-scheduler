import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        canvas: "#f5f6f8",
        ink: { DEFAULT: "#16202e", soft: "#46525f", faint: "#6b7480" },
        line: "#dfe3e8",
        accent: { 50: "#eef4ff", 100: "#dce8ff", 200: "#b3cdfb", 600: "#1f5fd6", 700: "#1a4fb3", 800: "#163f8c" },
        busy: { 50: "#fff4ec", 300: "#f9b07d", 400: "#f5924f", 700: "#a34a0c" },
      },
    },
  },
  plugins: [],
} satisfies Config;
