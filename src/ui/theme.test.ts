import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  THEME_CHOICES,
  THEME_STORAGE_KEY,
  currentTheme,
  nextChoice,
  renderThemeButton,
  resolveTheme,
  setChoice,
  storedChoice,
  themeLabel,
  wireThemeButton,
  type ThemeChoice,
} from "./theme";

const root = document.documentElement;

/** A device that answers yes to the media queries containing these words. */
function device(...says: string[]): void {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: says.some((s) => q.includes(s)),
    addEventListener: () => {},
  }));
}

beforeEach(() => {
  localStorage.clear();
  root.dataset.theme = "light";
  document.body.innerHTML = "";
  device();
});

describe("default", () => {
  it("is light when nothing is stored, whatever the OS colour scheme", () => {
    // ADR 008: Light does not follow the OS. Only "same as this device" does.
    device("color-scheme: dark", "prefers-contrast");
    expect(storedChoice()).toBe("light");
    expect(resolveTheme(storedChoice())).toBe("light");
  });

  it("ignores a stored value that is not a choice, the old \"contrast\" included", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "contrast");
    expect(storedChoice()).toBe("light");
  });
});

describe("same as this device", () => {
  it("resolves to dark on a dark system", () => {
    device("color-scheme: dark");
    expect(resolveTheme("system")).toBe("dark");
  });

  it("resolves to high contrast when the system asks for more contrast, dark or not", () => {
    device("prefers-contrast", "color-scheme: dark");
    expect(resolveTheme("system")).toBe("contrast");
  });

  it("resolves to light otherwise, and never stamps \"system\"", () => {
    setChoice("system");
    expect(root.dataset.theme).toBe("light");
    expect(currentTheme()).toBe("light");
  });
});

describe("storage", () => {
  it("remembers dark and system, and clears the value for light", () => {
    setChoice("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    setChoice("system");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    setChoice("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("still applies, and holds for the page, when storage throws", () => {
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setChoice("dark");
    expect(root.dataset.theme).toBe("dark");
    expect(storedChoice()).toBe("dark");
    set.mockRestore();
    get.mockRestore();
    setChoice("light");
  });
});

describe("button", () => {
  it("cycles Light → Dark → Same as this device", () => {
    expect(THEME_CHOICES.map(nextChoice)).toEqual(["dark", "system", "light"]);
  });

  it("names the current choice and the action", () => {
    expect(themeLabel("light")).toBe("Theme: light. Change it");
    expect(themeLabel("system")).toBe("Theme: same as this device. Change it");
    document.body.innerHTML = renderThemeButton("dark");
    const button = document.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("Theme: dark. Change it");
    expect(button.title).toBe("Theme: dark. Change it");
    expect(button.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps working after the screen is re-rendered", () => {
    // The styleguide bug: listeners attached to the buttons die with them.
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onChange = vi.fn();
    wireThemeButton(container, onChange);

    container.innerHTML = renderThemeButton("light");
    container.innerHTML = renderThemeButton("light");
    container.querySelector("button")!.click();

    expect(root.dataset.theme).toBe("dark");
    expect(onChange).toHaveBeenCalledWith("dark", "dark");
    expect(container.querySelector("button")!.getAttribute("aria-label")).toBe(
      "Theme: dark. Change it"
    );
  });
});

describe("first-paint script", () => {
  // Each HTML entry applies the stored choice before first paint with its own
  // copy of the key, the choices and the resolution. A copy that drifts
  // silently loses the person's choice on load, or flashes the wrong theme —
  // so run every one against the same cases as theme.ts.
  const cases: [string | null, string[], string][] = [
    [null, ["color-scheme: dark"], "light"],
    ["dark", [], "dark"],
    ["system", [], "light"],
    ["system", ["color-scheme: dark"], "dark"],
    ["system", ["prefers-contrast", "color-scheme: dark"], "contrast"],
    ["contrast", [], "light"],
  ];

  for (const file of ["index.html", "styleguide.html", "guidelines.html"]) {
    const html = readFileSync(join(__dirname, "../..", file), "utf8");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];

    it(`${file} stamps light in the HTML, before any script`, () => {
      expect(html).toContain('<html lang="en" data-theme="light">');
      expect(html.indexOf(THEME_STORAGE_KEY)).toBeLessThan(html.indexOf('type="module"'));
    });

    for (const [stored, says, expected] of cases) {
      it(`${file}: stored ${stored ?? "nothing"}, device [${says.join(", ")}] → ${expected}`, () => {
        if (stored) localStorage.setItem(THEME_STORAGE_KEY, stored);
        device(...says);
        root.dataset.theme = "light";
        new Function(script)();
        expect(root.dataset.theme).toBe(expected);
        // And the module agrees with it.
        expect(resolveTheme(storedChoice())).toBe(expected);
      });
    }

    it(`${file} follows the device while "same as this device" is chosen`, () => {
      const listeners: (() => void)[] = [];
      let dark = false;
      vi.stubGlobal("matchMedia", (q: string) => ({
        get matches() {
          return dark && q.includes("color-scheme: dark");
        },
        addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      }));
      localStorage.setItem(THEME_STORAGE_KEY, "system" satisfies ThemeChoice);
      new Function(script)();
      expect(root.dataset.theme).toBe("light");
      dark = true;
      listeners.forEach((fn) => fn());
      expect(root.dataset.theme).toBe("dark");

      // A later explicit choice is not overridden by the device.
      setChoice("light");
      dark = false;
      listeners.forEach((fn) => fn());
      dark = true;
      listeners.forEach((fn) => fn());
      expect(root.dataset.theme).toBe("light");
    });
  }
});
