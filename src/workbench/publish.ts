/**
 * "Put it on the map", signed in (Story 14.4 AC1): one button and the steps it
 * runs, each shown as it goes. The panel (`#publish`) is redrawn in place by
 * the page, so nothing else on the screen moves while a step runs.
 *
 * What each step says, and each failure with its one way forward (AC5), is the
 * tree's (`onb:ui*` on `:keep`); this file decides which line, never what it says.
 */
import type { Tile } from "../tree/parse";
import { bernard, esc } from "./html";
import { tileUi } from "./tilewords";

export const PUBLISH_UI_KEYS = [
  "uiPublishGo", "uiStepFile", "uiStepFileWorking", "uiStepFileWritten", "uiStepFileThere", "uiStepFileKept",
  "uiPublishNext", "uiPublishDropped", "uiPublishIncomplete", "uiMissingName", "uiMissingTown", "uiMissingCountry",
  "uiMissingPin", "uiPublishExpired", "uiPublishUnreachable", "uiPublishRefused", "uiPublishUnreadable",
  "uiStepPublic", "uiStepPublicWorking", "uiStepPublicDone", "uiStepPublicAlready", "uiPublicUnknown", "uiPublicNotPublic",
  "uiPublicBlocked", "uiPublicWider", "uiPublicNoControl", "uiPublicConflict", "uiPublicGone", "uiPublicNoWac",
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
}

export const IDLE: PublishState = { file: "idle", pub: "idle", pubLine: "", message: "", fileLine: "", dropped: "", failedCode: null };

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
  const done = state.file === "done" && state.pub === "done";
  const failed = state.file === "failed" || state.pub === "failed";
  const status = done ? [ui("uiPublishNext"), state.dropped].filter(Boolean).join(" ") : state.message;
  const line = (name: string, step: StepState, detail: string) =>
    `<li class="sp-unlock-step">${marker(step)}<span class="sp-unlock-body"><strong>${esc(name)}</strong>${
      detail ? ` <span class="wb-aside">${esc(detail)}</span>` : ""
    }</span></li>`;
  // Before the press there is only Bernard's line and the button: an empty step marker reads as a checkbox
  // to tick, and the step's name repeats Bernard (Nicolas, 2026-11-03). Each step shows once it has started.
  const steps =
    state.file === "idle"
      ? ""
      : `
    <ol class="wb-steps" aria-label="${esc(ui("uiPublishGo"))}">
      ${line(ui("uiStepFile"), state.file, state.file === "working" ? ui("uiStepFileWorking") : state.file === "done" ? state.fileLine : "")}
      ${state.pub === "idle" ? "" : line(ui("uiStepPublic"), state.pub, state.pub === "working" ? ui("uiStepPublicWorking") : state.pub === "done" ? state.pubLine : "")}
    </ol>`;
  const working = state.file === "working" || state.pub === "working";
  return `${steps}
    <p class="${failed ? "hint is-error" : "wb-aside"}" id="publish-status" role="status" tabindex="-1">${esc(status)}</p>
    ${
      done
        ? ""
        : `<div class="wb-form-actions"><button type="button" class="btn btn-primary wb-cta" id="publish-go"${
            working ? ' disabled aria-busy="true"' : ""
          }>${esc(ui("uiPublishGo"))}</button></div>`
    }`;
}

/** The panel in its box: the page redraws `#publish`'s inside in place, so the box is what is found. */
export function renderPublishBox(tile: Tile, state: PublishState): string {
  return `<div id="publish">${renderPublishPanel(tile, state)}</div>`;
}

/** The step's body when signed in with the pod made: Bernard, then the panel. */
export function renderPublish(tile: Tile, state: PublishState): string {
  return `
    ${bernard(tile.lines.sayPublish)}
    ${renderPublishBox(tile, state)}`;
}
