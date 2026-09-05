import {
  Button,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownPopover,
  DropdownTrigger,
  buttonVariants,
} from "@heroui/react";
import { Languages as LanguagesIcon, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "../i18n";
import type { ColorMode } from "../hooks/useColorMode";

type Props = {
  mode: ColorMode;
  onToggleTheme: () => void;
};

/**
 * The same bar synosoft.sr uses, minus the navigation this app has no need
 * for: one page, so brand on the left and the two preference controls on the
 * right. Keep the two in step - a user moving between the sites should not
 * have to look for the buttons twice.
 */
export default function SiteHeader({ mode, onToggleTheme }: Props) {
  const { t, i18n } = useTranslation();
  const active = i18n.language.split("-")[0] as SupportedLanguage;

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <nav
        aria-label="SVG Optimizer"
        className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6"
      >
        <a href="/" className="flex items-center gap-2">
          <img src="/logo.svg" className="h-7 w-7" alt="" role="presentation" />
          <span className="font-semibold tracking-tight text-foreground">
            SVG Optimizer
          </span>
        </a>

        <div className="-mr-2 flex items-center gap-1 sm:mr-0 sm:gap-2">
          {/*
            DropdownTrigger is the button itself and takes no variant prop, so
            it is styled with buttonVariants. The inline-flex is deliberate:
            the components layer sets .dropdown__trigger to inline-block, which
            beats .button's inline-flex and stacks the icon oddly. A utility
            class wins that fight.
          */}
          <Dropdown>
            <DropdownTrigger
              aria-label={t("common.language.label")}
              className={buttonVariants({
                variant: "ghost",
                isIconOnly: true,
                className: "inline-flex shrink-0",
              })}
            >
              <LanguagesIcon className="h-5 w-5" aria-hidden />
            </DropdownTrigger>
            {/* md:min-w-40 overrides HeroUI's md:min-w-55 default: 220px is
                sized for menus with icons and description lines, and two
                language names need about 70px. Matches synosoft.sr's navbar. */}
            <DropdownPopover className="md:min-w-40">
              <DropdownMenu
                aria-label={t("common.language.label")}
                selectedKeys={[active]}
                selectionMode="single"
                onAction={(key) => void i18n.changeLanguage(String(key))}
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <DropdownItem
                    key={lang}
                    id={lang}
                    textValue={String(t(`common.language.${lang}`))}
                  >
                    {t(`common.language.${lang}`)}
                  </DropdownItem>
                ))}
              </DropdownMenu>
            </DropdownPopover>
          </Dropdown>

          <Button
            isIconOnly
            variant="ghost"
            aria-label={t("common.theme.toggle")}
            onPress={onToggleTheme}
          >
            {mode === "light" ? (
              <Moon className="h-5 w-5" aria-hidden />
            ) : (
              <Sun className="h-5 w-5" aria-hidden />
            )}
          </Button>
        </div>
      </nav>
    </header>
  );
}
