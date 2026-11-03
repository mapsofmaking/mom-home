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
import { miniMapSlot } from "./minimap";
import type { OnMap } from "../lib/onmap";

export const HOURS_UI_KEYS = [
  "uiHoursLabel", "uiHoursHint", "uiHoursPlaceholder", "uiSave", "uiSaving", "uiHoursSame", "uiHoursEmpty",
  "uiHoursConflict", "uiHoursExpired", "uiHoursGone", "uiHoursUnreachable", "uiHoursRefused", "uiHoursUnreadable",
  "uiHoursWas", "uiHoursNew", "uiFileLabel", "uiHoursAgain", "uiHoursNoAccess", "uiHoursUnconfirmed",
  "uiStepWritten", "uiStepMapReading", "uiStepMapRead", "uiStepMapLate", "uiMapDidntRead", "uiMapRefusedFile", "uiMapAgain",
  "uiCardLabel", "uiHoursFact", "uiReloadHint",
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
  /** Once saved (S2, #37): the map reading the file. late: it took it but hasn't redrawn yet. */
  map: "idle" | "working" | "done" | "late" | "failed";
  /** The card as the map holds it, read back. */
  onMap: OnMap | null;
  /** Why the map didn't read it. */
  mapMessage: string;
}

export const hoursIdle = (current: string | undefined): HoursState => ({
  status: "idle", typed: current ?? "", message: "", was: null, saved: null, map: "idle", onMap: null, mapMessage: "",
});

const marker = (state: HoursState["map"] | "done") =>
  state === "done"
    ? `<span class="sp-unlock-marker tint" aria-hidden="true">✓</span>`
    : state === "working"
      ? `<span class="sp-unlock-marker now" aria-hidden="true">…</span>`
      : state === "failed"
        ? `<span class="sp-unlock-marker" aria-hidden="true">!</span>`
        : `<span class="sp-unlock-marker" aria-hidden="true"></span>`;

/** The steps a change travels, ticking (AC4), and the line under them. Redrawn in place while the map reads. */
export function renderMapSteps(tile: Tile, state: HoursState): string {
  const ui = hoursWords(tile);
  const step = (m: HoursState["map"] | "done", name: string, detail = "") =>
    `<li class="sp-unlock-step">${marker(m)}<span class="sp-unlock-body"><strong>${esc(name)}</strong>${detail ? ` <span class="wb-aside">${esc(detail)}</span>` : ""}</span></li>`;
  const mapLine =
    state.map === "working" ? step("working", ui("uiStepMapReading"))
    : state.map === "done" ? step("done", ui("uiStepMapRead"))
    : state.map === "late" ? step("done", ui("uiStepMapRead"), ui("uiStepMapLate"))
    : state.map === "failed" ? step("failed", ui("uiStepMapReading"))
    : "";
  return `
    <ol class="wb-steps">${step("done", ui("uiStepWritten"))}${mapLine}</ol>
    ${state.map === "failed"
      ? `<p class="hint is-error" id="hours-map-status" role="status" tabindex="-1">${esc(state.mapMessage)}</p>
         <div><button type="button" class="btn" id="hours-map-again">${esc(ui("uiMapAgain"))}</button></div>`
      : `<p class="wb-aside" id="hours-map-status" role="status">${state.map === "done" || state.map === "late" ? esc(ui("uiReloadHint")) : ""}</p>`}`;
}

/** The card as the map holds it (AC3): its pin and popup, and the hours it shows. Old hours until the map catches up. */
function renderCard(tile: Tile, state: HoursState): string {
  const ui = hoursWords(tile);
  const pin = state.onMap?.pin;
  if (!pin) return "";
  return `
    <div class="wb-flow-card">
      <p class="wf-label">${esc(ui("uiCardLabel"))}</p>
      <div class="wb-frame">
        ${miniMapSlot(pin.lat, pin.lon)}
        <div class="wb-popup"><div class="sp-hero"><span class="sp-name hand">${esc(pin.name)}</span>
          <span class="sp-address">${esc([pin.city, pin.country].filter(Boolean).join(", "))}</span></div></div>
      </div>
      <dl class="pv-facts"><dt>${esc(ui("uiHoursFact"))}</dt><dd${state.map === "done" ? ' class="hit"' : ""}>${esc(pin.hours || "—")}</dd></dl>
    </div>`;
}

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
  // File first, then the card: read left to right the way a change travels (AC0, AC3).
  return `
    ${bernard(tile.lines.saidDone ?? "")}
    <div id="hours-map">${renderMapSteps(tile, state)}</div>
    <p class="wb-aside" id="hours-was">${esc(was)}</p>
    <div class="wb-flow">
      <div class="wb-flow-file">
        <p class="wf-label">${esc(ui("uiFileLabel"))}</p>
        <pre class="wb-code" aria-label="${esc(ui("uiFileLabel"))}"><span>&lt;#space&gt; a mom:Space ;</span><span class="wb-code-gap">  …</span><span class="chg">  schema:openingHours ${esc(JSON.stringify(state.saved ?? ""))} ;</span><span class="wb-code-gap">  …</span></pre>
      </div>
      ${renderCard(tile, state)}
    </div>
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
