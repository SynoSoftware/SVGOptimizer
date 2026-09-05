// hero.ts - REVISED WITH content4 preserved and adjusted colors
import { heroui } from "@heroui/react";

export default heroui({
  defaultTheme: "light",
  themes: {
    light: {
      extend: "light",
      layout: {
        radius: {
          small: "4px",
          medium: "6px",
          large: "8px",
        },
      },
      colors: {
        // Brand primaries
        primary: { DEFAULT: "#009F6B", foreground: "#FFFFFF" },

        // Functional
        success: "#00A86B",
        warning: "#F5A623",
        danger: "#D64545",

        // Base page + text
        background: "#F3FBF6",   // REVISED: Light, distinctly green-ish white (was #FAFAFA)
        foreground: "#1C1C1C",   // main text (remains dark)
        divider: "#C8E6C9",      // REVISED: Lighter green divider
        focus: "#009F6B",

        // Surface levels (cards, dropdowns, etc.)
        content1: "#FFFFFF",     // REVISED: Pure white for main cards (was #FFFFFF, but now contrasts better with green background)
        content2: "#F0FDF4",     // REVISED: Slightly off-white/light-green for slightly raised elements
        content3: "#DCFCE7",     // REVISED: A bit more greenish for further elevation
        content4: "#D1FAE5",     // REVISED: Even more greenish (or for higher contrast elements)
      },
    },

dark: {
  extend: "dark",
  layout: {
    radius: {
      small: "4px",
      medium: "6px",
      large: "8px",
    },
  },
  colors: {
    primary: { DEFAULT: "#00DFA2", foreground: "#000000" },

    success: "#1FD18C",
    warning: "#E6A11B",
    danger: "#E25555",

    // *** Neutral graphite base ***
    background: "#0F1112",   // deep charcoal, no green
    foreground: "#F5F5F5",

    divider: "#2A2D2F",      // neutral cool gray divider

    // *** Neutral surfaces (NO GREEN) ***
    content1: "#1A1C1E",     // main card surface (graphite)
    content2: "#242628",     // slight elevation
    content3: "#2E3033",     // more elevation
    content4: "#3A3C3F",     // highest elevation
    focus: "#00DFA2"         // emerald stays as only accent
  },
},

  },
});