/**
 * Tile C, the logo (Story 14.6 S6, #41): shown once the hours are in the file, below them. The first
 * piece of the tool (S4 grows the other fields around it). Upload a logo, or give one already online.
 *
 * What it does is lib/logo.ts's; this file draws the panel and says the outcome. The card shows the
 * logo as the map holds it, always as an `<img>`, never inline.
 *
 * Its words are the tree's (`onb:uiLogo*` on `:change`).
 */
import type { Tile } from "../tree/parse";
import { esc } from "./html";
import { tileUi } from "./tilewords";
import { LOGO_TYPES } from "../lib/logo";

export const LOGO_UI_KEYS = [
  "uiLogoLabel", "uiLogoUpload", "uiLogoHint", "uiLogoOr", "uiLogoPlaceholder", "uiLogoUseAddress", "uiLogoSaving",
  "uiLogoSaved", "uiLogoReplaced", "uiLogoSame", "uiLogoTooLarge", "uiLogoNotImage", "uiLogoBadAddress", "uiLogoTaken",
  "uiLogoNotPublic", "uiLogoExpired", "uiLogoNoAccess", "uiLogoConflict", "uiLogoUnreachable", "uiLogoRefused",
  "uiLogoUnconfirmed", "uiLogoMapReading", "uiLogoMapRead", "uiLogoMapLate", "uiLogoMapDidntRead", "uiLogoFact",
] as const;
export type LogoUiKey = (typeof LOGO_UI_KEYS)[number];
export const logoWords = (tile: Pick<Tile, "ui"> | undefined) => tileUi<LogoUiKey>(tile, "tile C (logo)");

export interface LogoState {
  status: "idle" | "saving" | "done" | "failed";
  /** What the address field holds: kept across redraws and failures. */
  typed: string;
  /** The line under the panel: the outcome, or why it failed. */
  message: string;
  /** The map reading a new address (only when schema:logo changed). */
  map: "idle" | "working" | "done" | "late" | "failed";
}

export const logoIdle = (): LogoState => ({ status: "idle", typed: "", message: "", map: "idle" });

/** The logo's line under the panel, with the map's step when it reads a new address. */
function statusLine(tile: Tile, state: LogoState): string {
  const ui = logoWords(tile);
  const busy = state.status === "saving";
  const map =
    state.map === "working" ? ui("uiLogoMapReading")
    : state.map === "done" ? ui("uiLogoMapRead")
    : state.map === "late" ? ui("uiLogoMapLate")
    : state.map === "failed" ? ui("uiLogoMapDidntRead")
    : "";
  const text = busy ? ui("uiLogoSaving") : [state.message, map].filter(Boolean).join(" ");
  return `<p class="${state.status === "failed" ? "hint is-error" : "wb-aside"}" id="logo-status" role="status" tabindex="-1">${esc(text)}</p>`;
}

/** The panel: Upload a logo, or an address already online. Redrawn in place while it runs. */
export function renderLogoPanel(tile: Tile, state: LogoState): string {
  const ui = logoWords(tile);
  const busy = state.status === "saving";
  const off = busy ? " disabled" : "";
  return `
    <section class="wb-logo" aria-labelledby="logo-label">
      <p class="wb-field-label" id="logo-label">${esc(ui("uiLogoLabel"))}</p>
      <div class="wb-form-actions">
        <button type="button" class="btn" id="logo-pick"${off}${busy ? ' aria-busy="true"' : ""} aria-describedby="logo-hint">${esc(ui("uiLogoUpload"))}</button>
        <input type="file" id="logo-file" accept="${LOGO_TYPES.join(",")}" hidden />
      </div>
      <span class="hint" id="logo-hint">${esc(ui("uiLogoHint"))}</span>
      <form id="f-logo" class="wb-form wb-logo-address" novalidate>
        <label class="wb-field" for="f-logo-url">${esc(ui("uiLogoOr"))}
          <input id="f-logo-url" class="mono" name="logo" type="url" inputmode="url" autocomplete="off" value="${esc(state.typed)}"
            placeholder="${esc(ui("uiLogoPlaceholder"))}"${off} />
        </label>
        <div class="wb-form-actions"><button type="submit" class="btn" id="logo-use"${off}>${esc(ui("uiLogoUseAddress"))}</button></div>
      </form>
      ${statusLine(tile, state)}
    </section>`;
}

/**
 * The card's logo fact, as the map holds it: an `<img>` only. After a replacement the page refreshes the
 * browser's copy first (page.ts), so the address stays the one kept, with nothing added to it.
 */
export function logoFact(tile: Tile, logo: string): string {
  if (!/^https?:\/\//i.test(logo)) return "";
  const ui = logoWords(tile);
  return `<dt>${esc(ui("uiLogoFact"))}</dt><dd><img class="wb-card-logo" src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" /></dd>`;
}
