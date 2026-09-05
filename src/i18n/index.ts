import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import es from "./es.json";
import nl from "./nl.json";
import zh from "./zh.json";

export const resources = {
  en: { translation: en },
  es: { translation: es },
  nl: { translation: nl },
  zh: { translation: zh },
} as const;

export type SupportedLanguage = keyof typeof resources;

const supportedLanguages = Object.keys(resources) as SupportedLanguage[];

const normalize = (lang?: string | null): SupportedLanguage | null => {
  if (!lang) return null;
  const lower = lang.toLowerCase();
  if (supportedLanguages.includes(lower as SupportedLanguage)) {
    return lower as SupportedLanguage;
  }
  const base = lower.split("-")[0] as SupportedLanguage;
  return supportedLanguages.includes(base) ? base : null;
};

const stored = (): SupportedLanguage | null => {
  if (typeof window === "undefined") return null;
  try {
    return normalize(window.localStorage.getItem("lang"));
  } catch {
    return null;
  }
};

const fromBrowser = (): SupportedLanguage | null => {
  if (typeof navigator === "undefined") return null;
  for (const lang of navigator.languages ?? [navigator.language]) {
    const match = normalize(lang);
    if (match) return match;
  }
  return null;
};

void i18n.use(initReactI18next).init({
  resources,
  lng: stored() ?? fromBrowser() ?? "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (lang) => {
  try {
    window.localStorage.setItem("lang", lang);
  } catch {
    // A browser that refuses storage just forgets the choice.
  }
});

export default i18n;
