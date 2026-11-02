/**
 * The step panel: the selected tile, top to bottom (design system:
 * Workbench, "A step"): Bernard's line, the work, one way out.
 *
 * No tile is real yet (Stories 14.2–14.6 make them real one at a time): an
 * open tile shows its preview, labelled, with the chip COMING (AC6). A
 * coming tile shows its outcome and what it waits for, never its mechanism
 * (AC3). Bernard's lines come from the tree; so do tile A's own words (14.2
 * AC8, describe.ts). The rest of the system's words (chips, asides) are here.
 */
import type { TileState } from "../tree/fog";
import type { Tile } from "../tree/parse";
import { describeWords, renderDescribeForm, type DescribeWords } from "./describe";
import { bernard, esc } from "./html";
import { hasPreview, renderPreview, type Draft } from "./previews";
import type { PodMade } from "../lib/handoff";
import type { PodFormState } from "./podform";
import { renderPublish, renderPublishBox, type PublishState } from "./publish";
import { renderPodReady, renderThreshold, thresholdTitle, type Door, type OffersState } from "./threshold";

export interface StepContext {
  tiles: readonly Tile[];
  states: ReadonlyMap<string, TileState>;
  draft: Draft;
  /** Tile A reopened with "Fix something first". */
  editing?: boolean;
  /** Tile A's words; the page passes its one reader (read from the tile when absent). */
  words?: DescribeWords;
  /** Tile B (14.3): what the pod server offers (null: being asked), and the door chosen. */
  offers?: OffersState;
  door?: Door | null;
  /** The pod form's address and email, kept by the page across redraws. */
  pod?: PodFormState | null;
  /** Back from the sign-in that followed creating the pod (14.3 AC6): its address, once. */
  podReady?: string | null;
  /** A pod this tab made and did not sign in to (offered before the form), and whether "make another" was chosen. */
  prior?: PodMade | null;
  makeAnother?: boolean;
  /** Signed in with a pod: tile B publishes (Story 14.4) instead of offering the two doors. Absent: signed out. */
  publish?: PublishState | null;
}

function waitsFor(tile: Tile, ctx: StepContext): string {
  const ids = [...tile.requiresAll, ...tile.requiresAny];
  if (!ids.length) return "";
  const byId = new Map(ctx.tiles.map((t) => [t.id, t]));
  const steps = ids
    .map((id) => {
      const state = ctx.states.get(id) ?? "fog";
      // Outcome only, never mechanism (AC3): a requirement that is not done or open is shown by its cue.
      const req = byId.get(id)!;
      const name = state === "done" || state === "open" ? req.title : state === "fog" ? "Something still to discover" : req.cue;
      const marker =
        state === "done"
          ? `<span class="sp-unlock-marker tint" aria-hidden="true">✓</span>`
          : state === "open"
            ? `<span class="sp-unlock-marker now" aria-hidden="true">○</span>`
            : `<span class="sp-unlock-marker" aria-hidden="true"></span>`;
      const status = state === "done" ? "done" : "not yet";
      return `<li class="sp-unlock-step">${marker}<span class="sp-unlock-body"><strong>${esc(name)}</strong>
        <span class="visually-hidden">, ${status}</span></span></li>`;
    })
    .join("");
  const joiner = tile.requiresAny.length && !tile.requiresAll.length ? "Opens after one of these" : "Opens after";
  return `<p class="wf-label">${joiner}</p><ul class="wb-needs">${steps}</ul>`;
}

function comingStep(tile: Tile, state: TileState, ctx: StepContext): string {
  const never = tile.emergent || tile.planned;
  const body =
    state === "ready"
      ? `<p class="wb-aside">Ready. It opens as soon as you clear one of the open tiles: three at a time keeps the choice short.</p>`
      : (never ? bernard(tile.lines.say) : "") + waitsFor(tile, ctx);
  return `
    <p class="wf-label">Coming</p>
    <h2 class="wb-step-title" tabindex="-1">${esc(tile.cue)}</h2>
    ${body}`;
}

/**
 * Coming, for a preview of a tile not built yet (AC6). Tiles A and B are real: no chip.
 * No "Done" chip either (Nicolas, 14.2): the hexes already say it, and the step's content shows it.
 */
const chip = (tile: Tile, state: TileState) =>
  state === "done" || tile.act === "describe" || tile.act === "threshold" ? "" : `<span class="status-label">Coming</span>`;

const head = (tile: Tile, state: TileState) => `
    <div class="wb-step-head">
      <h2 class="wb-step-title" tabindex="-1">${esc(tile.title)}</h2>
      ${chip(tile, state)}
    </div>`;

/**
 * Tile A ("describe"): the form, then the card it makes. Done, it hands over
 * to the next tile in one step (design system: one way out).
 */
function describeStep(tile: Tile, state: TileState, ctx: StepContext): string {
  const w = ctx.words ?? describeWords(tile);
  if (state !== "done" || ctx.editing) {
    // A phone gets the shorter lead (AC2); home.css shows one of the two by width.
    const words = tile.leadShort
      ? `<span class="lead-full">${esc(tile.lead ?? "")}</span><span class="lead-short">${esc(tile.leadShort)}</span>`
      : esc(tile.lead ?? "");
    const lead = tile.lead
      ? `<p class="wb-lead">${words} <a class="inline-link" href="https://mapsofmaking.org" target="_blank" rel="noopener">${esc(w.ui("uiSeeMap"))}</a></p>`
      : "";
    return head(tile, state) + lead + renderDescribeForm(ctx.draft, w);
  }
  const kept = ctx.states.get("keep") === "done";
  // The way on is the next tile, by its own name.
  const next = ctx.tiles.find((t) => t.id === "keep");
  return `${head(tile, state)}
    ${bernard(tile.lines.saidDone)}
    ${hasPreview(tile.preview) ? renderPreview(tile.preview, ctx.draft) : ""}
    ${kept ? "" : bernard(tile.lines.sayNext)}
    <div class="wb-out">
      ${kept || !next ? "" : `<button type="button" class="btn btn-primary wb-cta" data-go="keep">${esc(next.title)}</button>`}
      <button type="button" class="inline-link" id="fix">${esc(w.ui(kept ? "uiChange" : "uiFix"))}</button>
    </div>`;
}

function openStep(tile: Tile, state: TileState, ctx: StepContext): string {
  if (tile.act === "describe") return describeStep(tile, state, ctx);
  // Done, tile B keeps showing what it showed (below): 14.4 writes the file and gives it its own "done" view.
  // Signed in with a pod: there is nothing to choose any more, only to put on the map (14.4).
  if (tile.act === "threshold" && state !== "done" && ctx.publish) {
    return `
    <div class="wb-step-head">
      <h2 class="wb-step-title" tabindex="-1">${esc(tile.title)}</h2>
    </div>${renderPublish(tile, ctx.publish)}`;
  }
  if (tile.act === "threshold" && state !== "done") {
    const t = { offers: ctx.offers ?? null, door: ctx.door ?? null, draft: ctx.draft, pod: ctx.pod ?? null, prior: ctx.prior ?? null, makeAnother: ctx.makeAnother ?? false };
    // The pod form carries its own heading: the door's name (storyboard B2).
    return `
    <div class="wb-step-head">
      <h2 class="wb-step-title" tabindex="-1">${esc(thresholdTitle(tile, t))}</h2>
    </div>${renderThreshold(tile, t)}`;
  }
  const line = state === "done" ? (tile.lines.saidDone ?? tile.lines.say) : tile.lines.say;
  return `${head(tile, state)}
    ${bernard(line)}
    ${hasPreview(tile.preview) ? renderPreview(tile.preview, ctx.draft) : ""}
    <div class="wb-out">
      <p class="wb-aside">This one isn't built yet. What it will do is above; nothing here is sent anywhere.</p>
    </div>`;
}

export function renderStep(tile: Tile, ctx: StepContext): string {
  // The hand-off speaks for tile B whatever its state: the pod exists, and the card is not on it yet (14.4).
  // Back from the sign-in, the first time: the pod is ready, and the button is right there.
  if (ctx.podReady && tile.act === "threshold") {
    return renderPodReady(tile, ctx.podReady, ctx.publish ? renderPublishBox(tile, ctx.publish) : "");
  }
  const state = ctx.states.get(tile.id) ?? "fog";
  if (state === "cue" || state === "ready") return comingStep(tile, state, ctx);
  if (state === "fog") return `<h2 class="wb-step-title" tabindex="-1">Still to discover</h2>`;
  return openStep(tile, state, ctx);
}
