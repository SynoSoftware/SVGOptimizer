/**
 * lucide-react 1.x ships its declarations at dist/lucide-react.d.ts but sets no
 * "types" field and no "exports" map, so bundler resolution follows "main" to
 * dist/cjs/lucide-react.js, finds no sibling .d.ts, and gives up.
 *
 * Pointing at the real declarations keeps full icon typing rather than falling
 * back to `any`. Delete this once the package declares its own types.
 */
declare module "lucide-react" {
  export * from "lucide-react/dist/lucide-react";
}
