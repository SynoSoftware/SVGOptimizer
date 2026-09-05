import type { ReactNode } from "react";

// Tailwind’s responsive container utility wrapper
export default function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto max-w-7xl px-4 sm:px-6 ${className}`}>
      {children}
    </div>
  );
}
