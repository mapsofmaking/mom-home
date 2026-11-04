/**
 * Tile C, a space that moves (Story 14.6 S5, AC1b, #40): shown once the hours are in the file, under the logo
 * (S6's place; the tool, S4, gathers the fields later). The street and town, prefilled from the file; "Move
 * the pin" places the new address with the geocoder (tile A's route, where.ts `findPlace`), then writes the
 * address and the pin together (lib/move.ts), then the map reads it.
 *
 * The wait is the steps that tick (AC4): "Found the new address: <the place found>" (so a wrong match shows),
 * "Written to your pod", "The map read it". An address the geocoder can't place is refused before anything is
 * written, naming the geocoder; what was typed stays.
 *
 * Its words are the tree's (`onb:uiMove*` on `:change`); the map's step reads the hours' (`uiStepMap*`).
 */
import type { Tile } from "../tree/parse";
import { esc } from "./html";
import { tileUi } from "./tilewords";
import { hoursWords, marker } from "./hours";

export const MOVE_UI_KEYS = [
  "uiMoveLabel", "uiMoveHint", "uiMoveStreet", "uiMoveCity", "uiMoveSave", "uiMoveEmpty", "uiMoveFinding", "uiMoveFound",
  "uiMoveStreetMissed", "uiMoveNoPlace", "uiMoveRate", "uiMoveUnavailable", "uiMoveWriting", "uiMoveWritten", "uiMoveDone",
  "uiMoveSame", "uiMoveExpired", "uiMoveNoAccess", "uiMoveConflict", "uiMoveGone", "uiMoveUnreachable", "uiMoveRefused",
  "uiMoveUnreadable", "uiMoveUnconfirmed",
] as const;
export type MoveUiKey = (typeof MOVE_UI_KEYS)[number];
export const moveWords = (tile: Pick<Tile, "ui"> | undefined) => tileUi<MoveUiKey>(tile, "tile C (move)");

export interface MoveState {
  /** finding: the geocoder; writing: the pod; done: written (the map's step follows); failed: nothing written, or not confirmed. */
  status: "idle" | "finding" | "writing" | "done" | "failed";
  /** What the fields hold: kept across redraws and failures. */
  street: string;
  city: string;
  /** The place the geocoder found, short; "" until found. */
  place: string;
  /** The street found nothing; the town's centre was found instead. */
  missed: boolean;
  /** The line under the steps: the outcome, or why it failed. */
  message: string;
  /** The map reading the moved file. */
  map: "idle" | "working" | "done" | "late" | "failed";
}

export const moveIdle = (street = "", city = ""): MoveState => ({
  status: "idle", street, city, place: "", missed: false, message: "", map: "idle",
});

function steps(tile: Tile, state: MoveState): string {
  if (state.status === "idle" || (state.status === "failed" && !state.place)) return "";
  const ui = moveWords(tile);
  const map = hoursWords(tile);
  const step = (m: "done" | "working" | "failed" | "idle", name: string, detail = "") =>
    `<li class="sp-unlock-step">${marker(m)}<span class="sp-unlock-body"><strong>${esc(name)}</strong>${detail ? ` <span class="wb-aside">${esc(detail)}</span>` : ""}</span></li>`;
  const found = state.place
    ? step("done", ui("uiMoveFound", { place: state.place }), state.missed ? ui("uiMoveStreetMissed", { city: state.city }) : "")
    : step("working", ui("uiMoveFinding"));
  const written =
    state.status === "writing" ? step("working", ui("uiMoveWriting"))
    : state.status === "done" ? step("done", ui("uiMoveWritten"))
    : "";
  const read =
    state.status !== "done" ? ""
    : state.map === "working" ? step("working", map("uiStepMapReading"), map("uiStepMapReadingWhy"))
    : state.map === "done" ? step("done", map("uiStepMapRead"))
    : state.map === "late" ? step("done", map("uiStepMapRead"), map("uiStepMapLate"))
    : state.map === "failed" ? step("failed", map("uiStepMapReading"), map("uiMapDidntRead"))
    : "";
  return `<ol class="wb-steps" id="move-steps">${found}${written}${read}</ol>`;
}

/** The panel: street and town, "Move the pin", the steps, the line under them. Redrawn in place while it runs. */
export function renderMovePanel(tile: Tile, state: MoveState): string {
  const ui = moveWords(tile);
  const busy = state.status === "finding" || state.status === "writing";
  const off = busy ? " disabled" : "";
  const failed = state.status === "failed";
  return `
    <section class="wb-move" aria-labelledby="move-label">
      <p class="wb-field-label" id="move-label">${esc(ui("uiMoveLabel"))}</p>
      <form id="f-move" class="wb-form" novalidate>
        <span class="hint" id="f-move-hint">${esc(ui("uiMoveHint"))}</span>
        <label class="wb-field" for="f-move-street">${esc(ui("uiMoveStreet"))}
          <input id="f-move-street" name="street" type="text" autocomplete="street-address" value="${esc(state.street)}" aria-describedby="f-move-hint"${off} />
        </label>
        <label class="wb-field" for="f-move-city">${esc(ui("uiMoveCity"))}
          <input id="f-move-city" name="city" type="text" autocomplete="address-level2" value="${esc(state.city)}"${off} />
        </label>
        <div class="wb-form-actions"><button type="submit" class="btn" id="move-save"${off}${busy ? ' aria-busy="true"' : ""}>${esc(ui("uiMoveSave"))}</button></div>
      </form>
      ${steps(tile, state)}
      <p class="${failed ? "hint is-error" : "wb-aside"}" id="move-status" role="status" tabindex="-1">${esc(state.message)}</p>
    </section>`;
}
