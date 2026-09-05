import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// HeroUI 3 is CSS-first: Tailwind runs as a Vite plugin, with no PostCSS
// pipeline and no Tailwind config file.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
