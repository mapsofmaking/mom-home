/**
 * Keeping a screen change perceivable when the screen is replaced wholesale.
 *
 * These apps render by assigning `innerHTML`, which destroys the focused
 * element. The browser then resets focus to the document root, silently: a
 * sighted user sees the new screen, while someone navigating by keyboard is
 * dumped back to the top with no announcement, and a screen reader says
 * nothing at all. It is invisible in testing and affects every screen change.
 *
 * `focusView` is the fix, and it belongs in the shell rather than in each
 * screen — a rule that every render has to remember is a rule that will be
 * forgotten.
 */

/**
 * Moves focus to the new view's heading so assistive tech announces it.
 *
 * `tabIndex = -1` makes the heading programmatically focusable without adding
 * it to the tab order — the heading should be reachable this way, but a user
 * tabbing through the page should not have to pass through it.
 *
 * `preventScroll` keeps the viewport where the browser already put it; without
 * it, focusing a heading that is already at the top can cause a visible jump.
 */
export function focusView(container: HTMLElement = document.body): void {
  const heading = container.querySelector<HTMLElement>("h1, h2, [data-view-title]");
  const target = heading ?? container;

  if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
  target.focus({ preventScroll: true });
}

/**
 * A single polite live region, reused for every announcement.
 *
 * Reused rather than created per message because assistive tech has to observe
 * a region *before* content lands in it — a region added and populated in the
 * same frame is frequently missed entirely.
 */
let liveRegion: HTMLElement | null = null;

function getLiveRegion(): HTMLElement {
  if (liveRegion?.isConnected) return liveRegion;

  liveRegion = document.createElement("div");
  liveRegion.setAttribute("role", "status");
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.className = "visually-hidden";
  document.body.appendChild(liveRegion);
  return liveRegion;
}

/**
 * Announces a message to assistive tech without showing it on screen.
 *
 * Use for state a sighted user learns from the screen changing — "Saved",
 * "3 results" — not for anything they would need to read.
 */
export function announce(message: string): void {
  const region = getLiveRegion();
  // Clearing first makes a repeated identical message announce again; without
  // it, "Saved" twice in a row is silent the second time.
  region.textContent = "";
  region.textContent = message;
}

/**
 * Records on `<html data-input>` whether the last input was the keyboard or a
 * pointer, so CSS can show focusView's ring only to someone navigating by
 * keyboard. Browsers treat a programmatic focus as `:focus-visible` on page
 * load, which rings the heading for a mouse user who never asked for it; a
 * screen reader still hears the heading either way.
 */
export function trackInputModality(root: HTMLElement = document.documentElement): void {
  root.dataset.input = "pointer";
  document.addEventListener("keydown", (e) => {
    if (e.key === "Tab" || e.key === "Enter" || e.key === " " || e.key.startsWith("Arrow")) {
      root.dataset.input = "keyboard";
    }
  }, true);
  document.addEventListener("pointerdown", () => { root.dataset.input = "pointer"; }, true);
}
