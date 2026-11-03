/**
 * "Put it on the map", signed in (Story 14.4 AC1): one button and the steps it
 * runs, each shown as it goes. The panel (`#publish`) is redrawn in place by
 * the page, so nothing else on the screen moves while a step runs.
 *
 * What each step says, and each failure with its one way forward (AC5), is the
 * tree's (`onb:ui*` on `:keep`); this file decides which line, never what it says.
 */
import type { OnMap } from "../lib/onmap";
import type { Tile } from "../tree/parse";
import { bernard, esc } from "./html";
import { tileUi } from "./tilewords";

export const PUBLISH_UI_KEYS = [
  "uiPublishGo", "uiStepFile", "uiStepFileWorking", "uiStepFileWritten", "uiStepFileThere", "uiStepFileKept",
  "uiPublishDropped", "uiPublishIncomplete", "uiMissingName", "uiMissingTown", "uiMissingCountry",
  "uiMissingPin", "uiPublishExpired", "uiPublishUnreachable", "uiPublishRefused", "uiPublishUnreadable",
  "uiStepPublic", "uiStepPublicWorking", "uiStepPublicDone", "uiStepPublicAlready", "uiPublicUnknown", "uiPublicNotPublic",
  "uiPublicBlocked", "uiPublicWider", "uiPublicNoControl", "uiPublicConflict", "uiPublicGone", "uiPublicNoWac",
  "uiStepMap", "uiStepMapWorking", "uiStepMapDone", "uiMapRefused", "uiMapDown", "uiOnMapLive", "uiPinLate",
  "uiFileAddress", "uiCopy", "uiCopied", "uiSeeOnMap",
] as const;
export type PublishUiKey = (typeof PUBLISH_UI_KEYS)[number];
export const publishWords = (tile: Pick<Tile, "ui"> | undefined) => tileUi<PublishUiKey>(tile, "tile B (publish)");

/** Where each step is. A failed step says why, in words, and keeps the button for the retry. */
export type StepState = "idle" | "working" | "done" | "failed";

export interface PublishState {
  /** Step 1, the file (S1). */
  file: StepState;
  /** Step 2, anyone can read it (S2). Runs once the file is done. */
  pub: StepState;
  /** What the public step says about itself once done. */
  pubLine: string;
  /** The line under the steps: what happened, or why the step that failed did. Empty while idle. */
  message: string;
  /** What a done step says about itself (written, already there, kept). */
  fileLine: string;
  /** Left out of the file, said once the file is done. */
  dropped: string;
  /** The code of the public step's failure: a retry resumes there, except when the file was gone. */
  failedCode: string | null;
  /** Step 3, on the map (S3, #13). */
  map: StepState;
  /** Where the map put the space, once registered. */
  onMap: OnMap | null;
  /** The file's address, for the threshold. */
  fileUrl: string;
}

export const IDLE: PublishState = {
  file: "idle", pub: "idle", pubLine: "", message: "", fileLine: "", dropped: "", failedCode: null, map: "idle", onMap: null, fileUrl: "",
};

/** All three steps done: the threshold shows instead of the steps. */
export const onTheMap = (s: PublishState) => s.file === "done" && s.pub === "done" && s.map === "done" && s.onMap !== null;

const marker = (state: StepState) =>
  state === "done"
    ? `<span class="sp-unlock-marker tint" aria-hidden="true">✓</span>`
    : state === "working"
      ? `<span class="sp-unlock-marker now" aria-hidden="true">…</span>`
      : state === "failed"
        ? `<span class="sp-unlock-marker" aria-hidden="true">!</span>`
        : `<span class="sp-unlock-marker" aria-hidden="true"></span>`;

/** The panel's inside: the steps, the line under them, the button. Pure, so the page can redraw it in place. */
export function renderPublishPanel(tile: Tile, state: PublishState): string {
  const ui = publishWords(tile);
  const failed = state.file === "failed" || state.pub === "failed" || state.map === "failed";
  const line = (name: string, step: StepState, detail: string) =>
    `<li class="sp-unlock-step">${marker(step)}<span class="sp-unlock-body"><strong>${esc(name)}</strong>${
      detail ? ` <span class="wb-aside">${esc(detail)}</span>` : ""
    }</span></li>`;
  // Before the press there is only Bernard's line and the button: an empty step marker reads as a checkbox
  // to tick, and the step's name repeats Bernard (Nicolas, 2026-11-03). Each step shows once it has started.
  const detail = (step: StepState, working: string, done: string) => (step === "working" ? working : step === "done" ? done : "");
  const steps =
    state.file === "idle"
      ? ""
      : `
    <ol class="wb-steps" aria-label="${esc(ui("uiPublishGo"))}">
      ${line(ui("uiStepFile"), state.file, detail(state.file, ui("uiStepFileWorking"), state.fileLine))}
      ${state.pub === "idle" ? "" : line(ui("uiStepPublic"), state.pub, detail(state.pub, ui("uiStepPublicWorking"), state.pubLine))}
      ${state.map === "idle" ? "" : line(ui("uiStepMap"), state.map, detail(state.map, ui("uiStepMapWorking"), ui("uiStepMapDone")))}
    </ol>`;
  const working = state.file === "working" || state.pub === "working" || state.map === "working";
  const status = failed ? state.message : state.dropped;
  return `${steps}
    <p class="${failed ? "hint is-error" : "wb-aside"}" id="publish-status" role="status" tabindex="-1">${esc(status)}</p>
    <div class="wb-form-actions"><button type="button" class="btn btn-primary wb-cta" id="publish-go"${
      working ? ' disabled aria-busy="true"' : ""
    }>${esc(ui("uiPublishGo"))}</button></div>`;
}

const COPY_ICON = `<svg class="copy-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 1h8a2 2 0 0 1 2 2v8h-2V3H5zM1 5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2zm2 0v8h7V5z"/></svg>`;

/**
 * The threshold, "You're on the map" (Story 14.4 AC4b): Bernard, the pin as the map
 * draws it (read back, labelled live; never drawn here), the file's address to copy,
 * and Bernard pointing at tile C, which is the one way on. `next` is tile C.
 */
export function renderThreshold(tile: Tile, state: PublishState, locality: string, next: Tile | undefined): string {
  const ui = publishWords(tile);
  const on = state.onMap!;
  const place = on.pin?.city || locality;
  const pin = on.pin
    ? `<p class="wf-label">${esc(ui("uiOnMapLive"))}</p>
       <p class="wb-pin ok"><span class="wb-pin-line">${esc(on.pin.name)} · ${esc(on.pin.lat.toFixed(5))}, ${esc(on.pin.lon.toFixed(5))}${
         on.pin.city ? ` · ${esc(on.pin.city)}` : ""
       }</span></p>`
    : `<p class="wb-aside">${esc(ui("uiPinLate"))}</p>`;
  return `
    ${bernard((tile.lines.saidDone ?? "").replace("{locality}", place))}
    ${pin}
    <p class="wf-label">${esc(ui("uiFileAddress"))}</p>
    <button type="button" class="copyable" id="copy-address" data-copy="${esc(state.fileUrl)}" aria-label="${esc(ui("uiCopy"))}: ${esc(state.fileUrl)}">${esc(state.fileUrl)}${COPY_ICON}</button>
    <p class="wb-aside" id="copy-status" role="status"></p>
    ${bernard(tile.lines.sayNext ?? "")}
    <div class="wb-out">
      ${next ? `<button type="button" class="btn btn-primary wb-cta" data-go="${esc(next.id)}">${esc(next.title)} →</button>` : ""}
      <a class="btn" href="${esc(on.link)}" target="_blank" rel="noopener">${esc(ui("uiSeeOnMap"))}</a>
    </div>`;
}

/** The panel in its box: the page redraws `#publish`'s inside in place, so the box is what is found. */
export function renderPublishBox(tile: Tile, state: PublishState): string {
  return `<div id="publish">${renderPublishPanel(tile, state)}</div>`;
}

/** The step's body when signed in with the pod made: Bernard, then the panel. */
export function renderPublish(tile: Tile, state: PublishState, locality = "", next?: Tile): string {
  if (onTheMap(state)) return renderThreshold(tile, state, locality, next);
  return `
    ${bernard(tile.lines.sayPublish)}
    ${renderPublishBox(tile, state)}`;
}
