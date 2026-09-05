import { Tooltip, TooltipContent, TooltipTrigger } from "@heroui/react";
import type { ReactNode } from "react";

/**
 * A tooltip with the content given as a prop.
 *
 * HeroUI 3 made Tooltip compound - trigger and content are separate children -
 * which is the right shape for a rich tooltip and pure noise for the seven
 * plain-text ones on this page. This keeps the structure in one place.
 */
export default function Hint({
  content,
  children,
  delay,
  closeDelay,
}: {
  content: ReactNode;
  children: ReactNode;
  delay?: number;
  closeDelay?: number;
}) {
  return (
    <Tooltip delay={delay} closeDelay={closeDelay}>
      <TooltipTrigger>{children}</TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  );
}
