/**
 * The card as the map's embed draws it (web/app.js showEmbedPopup): the name with the logo beside it, top
 * right, the address under them, the way out at the foot. Drawn from the pin the map read back (lib/onmap.ts),
 * never from what was typed: tile B's threshold and tile C's card.
 *
 * The logo is an `<img>` only. No logo, or one that fails to load, shows the map's placeholder (page.ts swaps
 * a failed image for it).
 */
import type { Pin } from "../lib/onmap";
import { esc } from "./html";

/** The map's placeholder for a space without a logo (web/app.js `_logoPlaceholder`). */
export const LOGO_PLACEHOLDER =
  `<svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="3" width="14" height="14" stroke="#8a8070" stroke-width="1.4"/><circle cx="7" cy="7.5" r="1.4" fill="#8a8070"/><polyline points="3,14 7,10 10,13 13,10 17,14" stroke="#8a8070" stroke-width="1.4" fill="none"/></svg>`;

function logoBox(logo: string): string {
  return /^https?:\/\//i.test(logo)
    ? `<div class="sp-logo"><img src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" /></div>`
    : `<div class="sp-logo is-placeholder">${LOGO_PLACEHOLDER}</div>`;
}

/** The popup over the small map: what a visitor sees on clicking the pin. */
export function livePopup(pin: Pin): string {
  const address = pin.address || [pin.city, pin.country].filter(Boolean).join(", ");
  return `
    <div class="wb-popup">
      <div class="sp-hero">
        <div class="sp-name-row"><span class="sp-name hand">${esc(pin.name)}</span>${logoBox(pin.logo)}</div>
        ${address ? `<span class="sp-address">${esc(address)}</span>` : ""}
      </div>
      <div class="wb-popup-foot">Open on mapsofmaking.org ↗</div>
    </div>`;
}

/** A logo that failed to load becomes the placeholder, as on the map. Listens once, on the page's root. */
export function swapBrokenLogos(root: HTMLElement): void {
  root.addEventListener(
    "error",
    (event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement)) return;
      const box = img.parentElement;
      if (!box?.classList.contains("sp-logo")) return;
      box.classList.add("is-placeholder");
      box.innerHTML = LOGO_PLACEHOLDER;
    },
    true
  );
}
