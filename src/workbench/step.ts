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

export interface StepContext {
  tiles: readonly Tile[];
  states: ReadonlyMap<string, TileState>;
  draft: Draft;
  /** Tile A reopened with "Fix something first". */
  editing?: boolean;
  /** Tile A's words; the page passes its one reader (read from the tile when absent). */
  words?: DescribeWords;
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
 * Coming, for a preview of a tile not built yet (AC6). Tile A is real: no chip.
 * No "Done" chip either (Nicolas, 14.2): the hexes already say it, and the step's content shows it.
 */
const chip = (tile: Tile, state: TileState) =>
  state === "done" || tile.act === "describe" ? "" : `<span class="status-label">Coming</span>`;

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
  const line = state === "done" ? (tile.lines.saidDone ?? tile.lines.say) : tile.lines.say;
  return `${head(tile, state)}
    ${bernard(line)}
    ${hasPreview(tile.preview) ? renderPreview(tile.preview, ctx.draft) : ""}
    <div class="wb-out">
      <p class="wb-aside">This one isn't built yet. What it will do is above; nothing here is sent anywhere.</p>
    </div>`;
}

export function renderStep(tile: Tile, ctx: StepContext): string {
  const state = ctx.states.get(tile.id) ?? "fog";
  if (state === "cue" || state === "ready") return comingStep(tile, state, ctx);
  if (state === "fog") return `<h2 class="wb-step-title" tabindex="-1">Still to discover</h2>`;
  return openStep(tile, state, ctx);
}
