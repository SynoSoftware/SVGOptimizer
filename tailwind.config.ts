// tailwind.config.ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {}, // Keep this empty for now
  },
  darkMode: "class",
  // Plugin is registered via `@plugin` in `src/index.css` (Tailwind v4)
  plugins: [],
};

export default config;
