/**
 * Tile B, "Publish it" (Story 14.3 AC1, AC4): the threshold. Two doors of the
 * same weight, and a real "not now". The choice is who looks after the file,
 * never the technology (bible §3: never rank the user's choices), so neither
 * door is primary, badged or focused first.
 *
 * The doors are the design system's (`.wb-door`: title, what it means, where
 * the file lives; storyboard B1). They are not restyled here: the first cut of
 * 14.3 S1 overrode them and lost the description and the address.
 *
 * The pod door depends on what the pod server says it offers (lib/provider.ts):
 * when it takes no accounts, or can't be reached, the step says so before any
 * field and the other door stays. Pressing the pod door opens its form in place
 * of the doors (podform.ts); the self-host door is 14.5. What each says is the
 * tree's (`onb:ui*` on `:keep`).
 */
import type { Offers } from "../lib/provider";
import { podAddress } from "../lib/podname";
import type { Tile } from "../tree/parse";
import { bernard, esc } from "./html";
import { renderPodForm, type PodFormState } from "./podform";
import type { Draft } from "./previews";
import { tileUi } from "./tilewords";

export type Door = "pod" | "self" | "notnow";

/** `null` while the descriptor is being read. */
export type OffersState = Offers | null;

/** Every `onb:ui*` line this step shows: each needs to be in the tree (voice.test.ts). */
export const THRESHOLD_UI_KEYS = [
  "uiDoorSelf", "uiDoorPod", "uiNotNow", "uiNotNowSaid", "uiDoorsAgain", "uiChecking",
  "uiNoRegister", "uiProviderDown", "uiTryAgain", "uiSelfSoon", "uiSelfSoonLink",
  "uiDoorSelfDesc", "uiDoorPodDesc", "uiDoorSelfWhere", "uiDoorsNote",
  "uiPodAddress", "uiPodEmail", "uiPodEmailHint", "uiPodPass", "uiPodPassAgain", "uiPodPassExample",
  "uiPodPassHint", "uiPodShow", "uiPodHide", "uiPodShowLabel", "uiPodHideLabel", "uiPodCreate",
  "uiPodOtherDoor", "uiPodStatus", "uiAddrEmpty", "uiAddrBad", "uiAddrLong", "uiEmailBad",
  "uiPassShort", "uiPassSpace", "uiPassMismatch",
] as const;
export type ThresholdUiKey = (typeof THRESHOLD_UI_KEYS)[number];

export const thresholdWords = (tile: Pick<Tile, "ui"> | undefined) => tileUi<ThresholdUiKey>(tile, "tile B");

export interface ThresholdContext {
  offers: OffersState;
  door: Door | null;
  draft: Draft;
  /** The pod form's address and email (the page keeps them across redraws); never the passphrase. */
  pod: PodFormState | null;
}

/** The pod form replaces the doors: only once the server has said it takes accounts. */
export const showsPodForm = (ctx: Pick<ThresholdContext, "offers" | "door">) => ctx.door === "pod" && ctx.offers === "open";

/** The step's heading: the tile's, or the door's own once its form is open (storyboard B2). */
export function thresholdTitle(tile: Tile, ctx: Pick<ThresholdContext, "offers" | "door">): string {
  return showsPodForm(ctx) ? thresholdWords(tile)("uiDoorPod") : tile.title;
}

const door = (id: "pod" | "self", title: string, desc: string, where: string, chosen: boolean, disabled = false) =>
  `<button type="button" class="wb-door" data-door="${id}" aria-pressed="${chosen}"${disabled ? " disabled" : ""}>
      <span class="wb-door-title">${esc(title)}</span>
      <span class="wb-door-desc">${esc(desc)}</span>
      ${where ? `<span class="wb-door-where">${esc(where)}</span>` : ""}
    </button>`;

/** The body of the step, under its head: Bernard, the server's answer, the doors (or the pod form), the way out. */
export function renderThreshold(tile: Tile, ctx: ThresholdContext): string {
  const ui = thresholdWords(tile);
  const { offers, door: chosen } = ctx;

  if (showsPodForm(ctx)) return renderPodForm(tile, ctx.pod ?? { name: "", email: "", nameTouched: false, emailTouched: false }, ui);

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

  // Where the pod would live, from what the coordinator described: the suggestion, as the form will show it.
  const podWhere = ctx.pod?.name ? podAddress(ctx.pod.name).replace(/^https?:\/\//, "") : "";
  // The pod door only while the server takes accounts; unknown yet, it waits disabled so it can't be pressed early.
  const podDoor =
    offers === "closed" || offers === "down"
      ? ""
      : door("pod", ui("uiDoorPod"), ui("uiDoorPodDesc"), podWhere, chosen === "pod", offers === null);
  const doors = `<div class="wb-doors" role="group" aria-label="${esc(tile.title)}">
      ${door("self", ui("uiDoorSelf"), ui("uiDoorSelfDesc"), ui("uiDoorSelfWhere"), chosen === "self")}${podDoor}
    </div>`;

  let reply = "";
  if (chosen === "self")
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
    ${offers === "open" || offers === null ? `<p class="wb-aside">${esc(ui("uiDoorsNote"))}</p>` : ""}
    ${reply ? `<div class="wb-reply" id="reply" tabindex="-1">${reply}</div>` : ""}
    <div class="wb-out">${way}</div>`;
}
