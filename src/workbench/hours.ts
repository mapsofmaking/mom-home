/**
 * Tile C, "Update it once", the first time (Story 14.6, storyboard C1 to C3): one field,
 * the opening hours, and Save; below it, read left to right the way a change travels,
 * the space's file as the pod holds it and the card as the map draws it (AC0, AC3).
 *
 * - C1, before: the file with its hours line marked, then the card with the hours it shows.
 * - C2, while the map reads: the file already says the new hours, the card still the old
 *   ones. The split is the lesson.
 * - C3, done: both agree; "was" names the old value; the tile hands back to the others.
 *
 * Live sources only: the file is the pod's text (read at sign-in, then read back after the
 * save, lib/hours.ts), the card the map's own (lib/onmap.ts). Nothing here draws either
 * from what was typed.
 *
 * Its words are the tree's (`onb:ui*` on `:change`); this file decides which line, never
 * what it says.
 */
import type { Tile } from "../tree/parse";
import { bernard, esc } from "./html";
import { tileUi } from "./tilewords";
import { miniMapSlot } from "./minimap";
import { highlightTurtle, highlightTurtleLine } from "./turtle";
import type { OnMap } from "../lib/onmap";
import { logoFact, renderLogoPanel, type LogoState } from "./logo";

export const HOURS_UI_KEYS = [
  "uiHoursLabel", "uiHoursHint", "uiHoursPlaceholder", "uiSave", "uiHoursFirst", "uiSaving", "uiHoursSame", "uiHoursEmpty",
  "uiHoursConflict", "uiHoursExpired", "uiHoursGone", "uiHoursUnreachable", "uiHoursRefused", "uiHoursUnreadable",
  "uiHoursWas", "uiHoursNew", "uiFileLabel", "uiHoursNoAccess", "uiHoursUnconfirmed",
  "uiStepWritten", "uiStepMapReading", "uiStepMapReadingWhy", "uiStepMapRead", "uiStepMapLate", "uiMapDidntRead",
  "uiMapRefusedFile", "uiMapAgain", "uiCardLabel", "uiCardFacts", "uiAddressFact", "uiHoursFact", "uiReloadHint",
  "uiBackToTiles", "uiTileStays", "uiFileFrom",
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
  /** The file as the pod holds it: read at sign-in, read back after a save. null: not read. */
  file: string | null;
  /** Once saved (S2, #37): the map reading the file. late: it took it but hasn't redrawn yet. */
  map: "idle" | "working" | "done" | "late" | "failed";
  /** The card as the map holds it: read at sign-in, read back after the map read the change. */
  onMap: OnMap | null;
  /** Why the map didn't read it. */
  mapMessage: string;
  /** The line the file marks: the hours, or the logo once it changed (S6, #41). */
  mark: "openingHours" | "logo";
}

export const hoursIdle = (current: string | undefined, file: string | null = null, onMap: OnMap | null = null): HoursState => ({
  status: "idle", typed: current ?? "", message: "", was: null, saved: null, file, map: "idle", onMap, mapMessage: "", mark: "openingHours",
});

const marker = (state: HoursState["map"] | "done") =>
  state === "done"
    ? `<span class="sp-unlock-marker tint" aria-hidden="true">✓</span>`
    : state === "working"
      ? `<span class="sp-unlock-marker now" aria-hidden="true">…</span>`
      : state === "failed"
        ? `<span class="sp-unlock-marker" aria-hidden="true">!</span>`
        : `<span class="sp-unlock-marker" aria-hidden="true"></span>`;

/** The form and the line under it: the part redrawn in place while the pod writes. */
export function renderHoursPanel(tile: Tile, state: HoursState): string {
  const ui = hoursWords(tile);
  const busy = state.status === "saving";
  const failed = state.status === "failed";
  return `
    <form id="f-hours" class="wb-form" novalidate>
      <label class="wb-field" for="f-hours-value">${esc(ui("uiHoursLabel"))}
        <input id="f-hours-value" class="mono" name="hours" type="text" autocomplete="off" value="${esc(state.typed)}"
          placeholder="${esc(ui("uiHoursPlaceholder"))}" aria-describedby="f-hours-hint"${busy ? " disabled" : ""} />
        <span class="hint" id="f-hours-hint">${esc(ui("uiHoursHint"))}</span>
      </label>
      <p class="${failed ? "hint is-error" : "wb-aside"}" id="hours-status" role="status" tabindex="-1">${esc(busy ? ui("uiSaving") : state.message)}</p>
      <div class="wb-form-actions wb-hours-actions"><button type="submit" class="btn btn-primary wb-cta" id="hours-save"${
        busy ? ' disabled aria-busy="true"' : ""
      }>${esc(ui("uiSave"))}</button><span class="wb-aside">${esc(ui("uiHoursFirst"))}</span></div>
    </form>`;
}

/** The steps a change travels, ticking (AC4), and the line under them. Redrawn in place while the map reads. */
export function renderMapSteps(tile: Tile, state: HoursState): string {
  const ui = hoursWords(tile);
  const step = (m: HoursState["map"] | "done", name: string, detail = "") =>
    `<li class="sp-unlock-step">${marker(m)}<span class="sp-unlock-body"><strong>${esc(name)}</strong>${detail ? ` <span class="wb-aside">${esc(detail)}</span>` : ""}</span></li>`;
  const mapLine =
    state.map === "working" ? step("working", ui("uiStepMapReading"), ui("uiStepMapReadingWhy"))
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

/** The file as the pod holds it, every line, the hours marked (storyboard: the design system's terminal). */
function renderFile(tile: Tile, state: HoursState): string {
  const ui = hoursWords(tile);
  const body = state.file
    ? highlightTurtle(state.file, state.mark === "logo" ? /schema:logo\b|schema\.org\/logo>/ : /openingHours/)
    : `<span class="line chg">${highlightTurtleLine(`  schema:openingHours ${JSON.stringify(state.saved ?? state.typed)} ;`)}</span>`;
  // The design system's source terminal, as the map's card shows a space file (Turtle · endpoint response).
  return `
    <div class="wb-flow-file">
      <p class="wf-label">${esc(ui("uiFileLabel"))}</p>
      <div class="sp-terminal-wrap">
        <div class="sp-terminal-head"><span>Turtle · space.ttl</span><span>${esc(ui("uiFileFrom"))}</span></div>
        <pre class="turtle sp-terminal-body wb-file" tabindex="0" aria-label="${esc(ui("uiFileLabel"))}">${body}</pre>
      </div>
    </div>`;
}

/** The card as the map holds it: its pin and popup, then what its profile shows. Old hours until the map caught up. */
function renderCard(tile: Tile, state: HoursState): string {
  const ui = hoursWords(tile);
  const pin = state.onMap?.pin;
  if (!pin) return "";
  const fresh = state.map === "done";
  return `
    <span class="wb-flow-arrow" aria-hidden="true">→</span>
    <div class="wb-flow-card">
      <p class="wf-label">${esc(ui("uiCardLabel"))}</p>
      <div class="wb-frame">
        ${miniMapSlot(pin.lat, pin.lon)}
        <div class="wb-popup"><div class="sp-hero"><span class="sp-name hand">${esc(pin.name)}</span>
          <span class="sp-address">${esc([pin.city, pin.country].filter(Boolean).join(", "))}</span></div></div>
      </div>
      <div class="wb-facts-box">
        <span class="wb-aside">${esc(ui("uiCardFacts"))}</span>
        <dl class="pv-facts">
          <dt>${esc(ui("uiAddressFact"))}</dt><dd>${esc(pin.address || "—")}</dd>
          <dt class="hit">${esc(ui("uiHoursFact"))}</dt><dd class="hit${fresh ? " fresh" : ""}">${esc(pin.hours || "—")}</dd>
          ${logoFact(tile, pin.logo)}
        </dl>
      </div>
    </div>`;
}

const flow = (tile: Tile, state: HoursState) => `<div class="wb-flow">${renderFile(tile, state)}${renderCard(tile, state)}</div>`;

/** Saved: the steps, then (once the map answered) Bernard and what it was; the file and the card; the way back. */
function renderSaved(tile: Tile, state: HoursState): string {
  const ui = hoursWords(tile);
  const answered = state.map !== "working";
  const was = state.was ? `<b>${esc(ui("uiHoursLabel"))}</b> ${esc(ui("uiHoursWas", { was: state.was }))}` : esc(ui("uiHoursNew"));
  return `
    ${answered ? bernard(tile.lines.saidDone ?? "") : ""}
    <div id="hours-map">${renderMapSteps(tile, state)}</div>
    ${answered ? `<p class="wb-aside" id="hours-was">${was}</p>` : ""}
    ${flow(tile, state)}
    ${answered ? `<div class="wb-out"><button type="button" class="btn" id="hours-back">${esc(ui("uiBackToTiles"))}</button><span class="wb-aside">${esc(ui("uiTileStays"))}</span></div>` : ""}`;
}

/**
 * The step's body, signed in with the space on the pod. `logo`: the hours are in the file, so the logo
 * panel shows below them (S6, #41); absent the first time, which is the hours only.
 */
export function renderHours(tile: Tile, state: HoursState, logo: LogoState | null = null): string {
  return `
    <div class="wb-step-head">
      <h2 class="wb-step-title" tabindex="-1">${esc(tile.title)}</h2>
    </div>
    ${state.status === "saved"
      ? renderSaved(tile, state)
      : `${bernard(tile.lines.say)}<div id="hours">${renderHoursPanel(tile, state)}</div>${logo ? `<div id="logo">${renderLogoPanel(tile, logo)}</div>` : ""}${flow(tile, state)}`}`;
}
