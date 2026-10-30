/**
 * The theme switch: Light by default for everyone, then Dark, then "Same as
 * this device". See ADR 008 (amended).
 *
 * Light does not follow the operating system. These apps address everyday
 * people, for whom dark-by-default is a developer habit rather than a
 * preference, and the light paper ground is the calmer of the two. A person
 * who wants their device to decide says so, with the third step of the cycle.
 *
 * Three names, two lists, and the difference matters:
 *
 * - a CHOICE is what the person picked: light, dark or system. Light is the
 *   default, so choosing it CLEARS the stored value rather than storing it;
 * - a THEME is what is stamped on `<html data-theme>`: light, dark or
 *   contrast. "system" is never stamped. It is resolved to one of the three
 *   from `prefers-contrast` and `prefers-color-scheme`, so every theme's
 *   values live once, in theme.css, with no duplicated `@media` block.
 *
 * High contrast is not in the cycle. It is what "same as this device" gives a
 * person whose system asks for more contrast. The contrast question is asked
 * first: someone who asked for more contrast on a dark system gets High
 * contrast, which is the one theme built to be found by outline alone.
 *
 * The HTML stamps `data-theme="light"` itself, and a blocking inline script
 * in each entry (index, styleguide, guidelines) applies a stored choice before
 * first paint, resolving "system" and following the device while the page is
 * open. A module script runs too late: a dark choice would flash light on
 * every load. That script duplicates the key, the choices and `resolveTheme`
 * by necessity; theme.test.ts runs each copy to keep them in step.
 */

export const THEME_CHOICES = ["light", "dark", "system"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export const THEMES = ["light", "dark", "contrast"] as const;
export type Theme = (typeof THEMES)[number];

/**
 * Shared by every app on one origin, on purpose — unlike SESSION_ID. Someone
 * who needs their device's dark setting in one app needs it in the next one.
 */
export const THEME_STORAGE_KEY = "solid-kit:theme";

const isChoice = (value: unknown): value is ThemeChoice =>
  typeof value === "string" && (THEME_CHOICES as readonly string[]).includes(value);

const isTheme = (value: unknown): value is Theme =>
  typeof value === "string" && (THEMES as readonly string[]).includes(value);

/** Without storage, the choice still holds until the page reloads. */
let unstored: ThemeChoice = "light";

/**
 * The person's choice. Light when nothing is stored, and when the stored value
 * is not a choice: "contrast", stored by the kit before the amendment, is no
 * longer one, and falls back to the default rather than to a guess.
 */
export function storedChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "dark" || value === "system" ? value : "light";
  } catch {
    return unstored;
  }
}

/** The device's preference, asked in the order the comment above explains. */
function deviceTheme(): Theme {
  if (typeof matchMedia !== "function") return "light";
  if (matchMedia("(prefers-contrast: more)").matches) return "contrast";
  if (matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

/** What a choice puts on screen right now. */
export function resolveTheme(choice: ThemeChoice): Theme {
  return choice === "system" ? deviceTheme() : choice;
}

/** The theme on screen right now: the stamp, or Light. */
export function currentTheme(root: HTMLElement = document.documentElement): Theme {
  const stamped = root.dataset.theme;
  return isTheme(stamped) ? stamped : "light";
}

/** Stamps what `choice` resolves to. Never stores. */
export function applyChoice(choice: ThemeChoice, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = resolveTheme(choice);
}

/**
 * Applies and remembers a choice. Light clears the stored value: it is the
 * default, and a stored "light" would outlive a change of default.
 */
export function setChoice(choice: ThemeChoice, root: HTMLElement = document.documentElement): void {
  unstored = choice;
  try {
    if (choice === "light") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage unavailable: the choice holds for this page view.
  }
  applyChoice(choice, root);
}

export function nextChoice(choice: ThemeChoice): ThemeChoice {
  return THEME_CHOICES[(THEME_CHOICES.indexOf(choice) + 1) % THEME_CHOICES.length];
}

/** The current choice and the action, in plain words: "Theme: dark. Change it". */
export function themeLabel(choice: ThemeChoice): string {
  return `Theme: ${choice === "system" ? "same as this device" : choice}. Change it`;
}

/** 24-unit icons in currentColor: a sun, a moon, a half-filled disc. */
const ICONS: Record<ThemeChoice, string> = {
  light: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`,
  dark: `<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>`,
  system: `<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>`,
};

const icon = (choice: ThemeChoice): string =>
  `<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[choice]}</svg>`;

/**
 * The switch: one icon button, for the top bar or a landing's nav. The label
 * carries the meaning (`aria-label` and `title`); the icon is decoration.
 */
export function renderThemeButton(choice: ThemeChoice = storedChoice()): string {
  const label = themeLabel(choice);
  return `<button type="button" class="ghost small icon-button" data-theme-button
    data-theme-choice="${choice}" aria-label="${label}" title="${label}">${icon(choice)}</button>`;
}

/**
 * Wires every theme button inside `container`, once, by delegation — screens
 * replace their DOM on each render, and listeners attached to the buttons
 * themselves would be lost with them (the styleguide learned this the hard
 * way).
 *
 * Every button in the container is updated in place, so a screen does not have
 * to re-render for it; `onChange` is for the screens that must (the styleguide
 * recomputes its contrast figures).
 */
export function wireThemeButton(
  container: HTMLElement,
  onChange?: (choice: ThemeChoice, theme: Theme) => void
): void {
  container.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-theme-button]");
    if (!button) return;
    const from = isChoice(button.dataset.themeChoice) ? button.dataset.themeChoice : storedChoice();
    const choice = nextChoice(from);
    setChoice(choice);
    container.querySelectorAll<HTMLButtonElement>("[data-theme-button]").forEach((b) => {
      const label = themeLabel(choice);
      b.dataset.themeChoice = choice;
      b.setAttribute("aria-label", label);
      b.title = label;
      b.innerHTML = icon(choice);
    });
    onChange?.(choice, currentTheme());
  });
}
