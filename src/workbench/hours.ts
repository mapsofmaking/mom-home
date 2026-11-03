/**
 * Tile C, "Update it once", the first time (Story 14.6 S1, #36): one field, the
 * opening hours, and Save. The change goes into the space's file on the pod
 * (lib/hours.ts); then the file line that changed is shown, read back.
 *
 * Its words are the tree's (`onb:ui*` on `:change`); this file decides which line,
 * never what it says. The panel (`#hours`) is redrawn in place while a save runs,
 * so nothing else on the screen moves under the coordinator.
 */
import type { Tile } from "../tree/parse";
import { bernard, esc } from "./html";
import { tileUi } from "./tilewords";

export const HOURS_UI_KEYS = [
  "uiHoursLabel", "uiHoursHint", "uiHoursPlaceholder", "uiSave", "uiSaving", "uiHoursSame", "uiHoursEmpty",
  "uiHoursConflict", "uiHoursExpired", "uiHoursGone", "uiHoursUnreachable", "uiHoursRefused", "uiHoursUnreadable",
  "uiHoursWas", "uiHoursNew", "uiFileLabel", "uiHoursAgain", "uiHoursNoAccess", "uiHoursUnconfirmed",
] as const;
export type HoursUiKey = (typeof HOURS_UI_KEYS)[number];
export const hoursWords = (tile: Pick<Tile, "ui"> | undefined) => tileUi<HoursUiKey>(tile, "tile C (hours)");

export interface HoursState {
  status: "idle" | "saving" | "saved" | "failed";
  /** What the field holds: kept across redraws and failures, never lost. */
  typed: string;
  /** The line under the button: why it failed, or why nothing was written. */
  message: string;
  /** Once saved: what the file said before (null: no hours), and what it says now. */
  was: string | null;
  saved: string | null;
}

export const hoursIdle = (current: string | undefined): HoursState => ({
  status: "idle", typed: current ?? "", message: "", was: null, saved: null,
});

/** The form and the line under it: the part redrawn in place. */
export function renderHoursPanel(tile: Tile, state: HoursState): string {
  const ui = hoursWords(tile);
  const busy = state.status === "saving";
  const failed = state.status === "failed";
  return `
    <form id="f-hours" class="wb-form" novalidate>
      <label class="wb-field" for="f-hours-value">${esc(ui("uiHoursLabel"))}
        <input id="f-hours-value" name="hours" type="text" autocomplete="off" value="${esc(state.typed)}"
          placeholder="${esc(ui("uiHoursPlaceholder"))}" aria-describedby="f-hours-hint"${busy ? " disabled" : ""} />
        <span class="hint" id="f-hours-hint">${esc(ui("uiHoursHint"))}</span>
      </label>
      <p class="${failed ? "hint is-error" : "wb-aside"}" id="hours-status" role="status" tabindex="-1">${esc(busy ? ui("uiSaving") : state.message)}</p>
      <div class="wb-form-actions"><button type="submit" class="btn btn-primary wb-cta" id="hours-save"${
        busy ? ' disabled aria-busy="true"' : ""
      }>${esc(ui("uiSave"))}</button></div>
    </form>`;
}

/** Saved: Bernard, what it was, and the line of the file that changed, read back. */
function renderSaved(tile: Tile, state: HoursState): string {
  const ui = hoursWords(tile);
  const was = state.was ? ui("uiHoursWas", { was: state.was }) : ui("uiHoursNew");
  return `
    ${bernard(tile.lines.saidDone ?? "")}
    <p class="wb-aside" id="hours-was">${esc(was)}</p>
    <p class="wf-label">${esc(ui("uiFileLabel"))}</p>
    <pre class="wb-file-line"><code><mark>schema:openingHours ${esc(JSON.stringify(state.saved ?? ""))} ;</mark></code></pre>
    <div class="wb-out"><button type="button" class="btn" id="hours-again">${esc(ui("uiHoursAgain"))}</button></div>`;
}

/** The step's body, signed in with the space on the pod. */
export function renderHours(tile: Tile, state: HoursState): string {
  return `
    <div class="wb-step-head">
      <h2 class="wb-step-title" tabindex="-1">${esc(tile.title)}</h2>
    </div>
    ${state.status === "saved" ? renderSaved(tile, state) : `${bernard(tile.lines.say)}<div id="hours">${renderHoursPanel(tile, state)}</div>`}`;
}
