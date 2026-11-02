/**
 * Tile B, "Publish it" (Story 14.3 AC1, AC4): the threshold. Two doors of the
 * same weight, and a real "not now". The choice is who looks after the file,
 * never the technology (bible §3: never rank the user's choices), so neither
 * door is primary, badged or focused first.
 *
 * The pod door depends on what the pod server says it offers (lib/provider.ts):
 * when it takes no accounts, or can't be reached, the step says so before any
 * field and the other door stays. What each door says is the tree's (`onb:ui*`
 * on `:keep`); the form behind the pod door is S2, the self-host door 14.5.
 */
import type { Offers } from "../lib/provider";
import type { Tile } from "../tree/parse";
import { bernard, esc } from "./html";
import { tileUi } from "./tilewords";

export type Door = "pod" | "self" | "notnow";

/** `null` while the descriptor is being read. */
export type OffersState = Offers | null;

/** Every `onb:ui*` line this step shows: each needs to be in the tree (voice.test.ts). */
export const THRESHOLD_UI_KEYS = [
  "uiDoorSelf", "uiDoorPod", "uiNotNow", "uiNotNowSaid", "uiDoorsAgain", "uiChecking",
  "uiNoRegister", "uiProviderDown", "uiTryAgain", "uiSelfSoon", "uiSelfSoonLink",
] as const;
export type ThresholdUiKey = (typeof THRESHOLD_UI_KEYS)[number];

export const thresholdWords = (tile: Pick<Tile, "ui"> | undefined) => tileUi<ThresholdUiKey>(tile, "tile B");

export interface ThresholdContext {
  offers: OffersState;
  door: Door | null;
}

const door = (id: "pod" | "self", label: string, chosen: boolean, disabled = false) =>
  `<button type="button" class="btn wb-door" data-door="${id}" aria-pressed="${chosen}"${disabled ? " disabled" : ""}>${esc(label)}</button>`;

/** The body of the step, under its head: Bernard, the server's answer, the doors, the way out. */
export function renderThreshold(tile: Tile, ctx: ThresholdContext): string {
  const ui = thresholdWords(tile);
  const { offers, door: chosen } = ctx;

  // What the server said comes before any door (AC4), in the app's voice, not Bernard's.
  const aside =
    offers === null
      ? `<p class="wb-aside" role="status">${esc(ui("uiChecking"))}</p>`
      : offers === "closed"
        ? `<p class="wb-aside" role="status">${esc(ui("uiNoRegister"))}</p>`
        : offers === "down"
          ? `<p class="wb-aside" role="status">${esc(ui("uiProviderDown"))}
              <button type="button" class="inline-link" id="offers-retry">${esc(ui("uiTryAgain"))}</button></p>`
          : "";

  // The pod door only while the server takes accounts; unknown yet, it waits disabled so it can't be pressed early.
  const podDoor = offers === "closed" || offers === "down" ? "" : door("pod", ui("uiDoorPod"), chosen === "pod", offers === null);
  const doors = `<div class="wb-doors" role="group" aria-label="${esc(tile.title)}">
      ${door("self", ui("uiDoorSelf"), chosen === "self")}${podDoor}
    </div>`;

  let reply = "";
  if (chosen === "pod" && offers === "open") reply = bernard(tile.lines.sayPod);
  else if (chosen === "self")
    reply = `<p class="wb-aside">${esc(ui("uiSelfSoon"))}
      <a class="inline-link" href="https://mapsofmaking.org" target="_blank" rel="noopener">${esc(ui("uiSelfSoonLink"))}</a></p>`;
  else if (chosen === "notnow") reply = `<p class="wb-aside">${esc(ui("uiNotNowSaid"))}</p>`;

  const way =
    chosen === "notnow"
      ? `<button type="button" class="inline-link" id="doors-again">${esc(ui("uiDoorsAgain"))}</button>`
      : `<button type="button" class="inline-link" id="not-now">${esc(ui("uiNotNow"))}</button>`;

  return `
    ${bernard(tile.lines.say)}
    ${aside}
    ${doors}
    ${reply ? `<div class="wb-reply" id="reply" tabindex="-1">${reply}</div>` : ""}
    <div class="wb-out">${way}</div>`;
}
