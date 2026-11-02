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
] as const;
export type PublishUiKey = (typeof PUBLISH_UI_KEYS)[number];
export const publishWords = (tile: Pick<Tile, "ui"> | undefined) => tileUi<PublishUiKey>(tile, "tile B (publish)");

/** Where each step is. A failed step says why, in words, and keeps the button for the retry. */
export interface PublishState {
  file: "idle" | "working" | "done" | "failed";
  /** The line under the steps: what happened to the file, or why it failed. Empty while idle. */
  message: string;
  /** What a done step says about itself (written, already there, kept). */
  fileLine: string;
  /** Left out of the file, said once the file is done. */
  dropped: string;
}

export const IDLE: PublishState = { file: "idle", message: "", fileLine: "", dropped: "" };

const marker = (state: PublishState["file"]) =>
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
  const detail =
    state.file === "working" ? ui("uiStepFileWorking") : state.file === "done" ? state.fileLine : "";
  const status = state.file === "done" ? [ui("uiPublishNext"), state.dropped].filter(Boolean).join(" ") : state.message;
  return `
    <ol class="wb-steps" aria-label="${esc(ui("uiPublishGo"))}">
      <li class="sp-unlock-step">${marker(state.file)}<span class="sp-unlock-body"><strong>${esc(ui("uiStepFile"))}</strong>${
        detail ? ` <span class="wb-aside">${esc(detail)}</span>` : ""
      }</span></li>
    </ol>
    <p class="${state.file === "failed" ? "hint is-error" : "wb-aside"}" id="publish-status" role="status" tabindex="-1">${esc(status)}</p>
    ${
      state.file === "done"
        ? ""
        : `<div class="wb-form-actions"><button type="button" class="btn btn-primary wb-cta" id="publish-go"${
            state.file === "working" ? ' disabled aria-busy="true"' : ""
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
