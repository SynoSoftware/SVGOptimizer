import { Suspense, lazy } from "react";
import SvgOptimizer from "./pages/SvgOptimizer";
import { useColorMode } from "./hooks/useColorMode";
import SiteHeader from "./components/SiteHeader";

// Development only: the import sits in a branch Vite folds away for the
// production build, so neither the page nor its fixtures ship.
const OptimizerSelfTest = import.meta.env.DEV
  ? lazy(() => import("./pages/OptimizerSelfTest"))
  : null;

// Two views and no navigation between them do not justify a router. Vercel
// rewrites every path to index.html, so a deep link still lands here.
const isSelfTest = () =>
  typeof window !== "undefined" &&
  window.location.pathname.replace(/\/+$/, "").endsWith("/selftest");

export default function App() {
  const selfTest = Boolean(OptimizerSelfTest) && isSelfTest();
  // HeroUI 3 has no provider. The theme is the `dark` class on <html>, which
  // this hook owns, and every component reads the CSS variables under it.
  const { mode, toggle } = useColorMode();

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground texture-emerald">
      <SiteHeader mode={mode} onToggleTheme={toggle} />
      <main className="flex-1">
        <Suspense fallback={null}>
          {selfTest && OptimizerSelfTest ? (
            <OptimizerSelfTest />
          ) : (
            <SvgOptimizer />
          )}
        </Suspense>
      </main>
    </div>
  );
}
