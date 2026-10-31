/**
 * The step panel: the selected tile, top to bottom (design system:
 * Workbench, "A step"): Bernard's line, the work, one way out.
 *
 * No tile is real yet (Stories 14.2–14.6 make them real one at a time): an
 * open tile shows its preview, labelled, with the chip COMING (AC6). A
 * coming tile shows its outcome and what it waits for, never its mechanism
 * (AC3). Bernard's lines come from the tree; the system's own words (labels,
 * hints) are here.
 */
import type { TileState } from "../tree/fog";
import type { Tile } from "../tree/parse";
import { renderDescribeForm } from "./describe";
import { bernard, esc } from "./html";
import { hasPreview, renderPreview, type Draft } from "./previews";

export interface StepContext {
  tiles: readonly Tile[];
  states: ReadonlyMap<string, TileState>;
  draft: Draft;
  /** Tile A reopened with "Fix something first". */
  editing?: boolean;
}

function waitsFor(tile: Tile, ctx: StepContext): string {
  const ids = [...tile.requiresAll, ...tile.requiresAny];
  if (!ids.length) return "";
  const byId = new Map(ctx.tiles.map((t) => [t.id, t]));
  const steps = ids
    .map((id) => {
      const state = ctx.states.get(id) ?? "fog";
      const name = state === "fog" ? "Something still to discover" : byId.get(id)!.title;
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

const head = (tile: Tile, state: TileState) => `
    <div class="wb-step-head">
      <h2 class="wb-step-title" tabindex="-1">${esc(tile.title)}</h2>
      ${state === "done" ? `<span class="status-label shut">Done</span>` : `<span class="status-label">Coming</span>`}
    </div>`;

/**
 * Tile A ("describe"): the form, then the card it makes. Done, it hands over
 * to the next tile in one step (design system: one way out).
 */
function describeStep(tile: Tile, state: TileState, ctx: StepContext): string {
  if (state !== "done" || ctx.editing) return head(tile, state) + bernard(tile.lines.say) + renderDescribeForm(ctx.draft);
  const kept = ctx.states.get("keep") === "done";
  return `${head(tile, state)}
    ${bernard(tile.lines.saidDone)}
    ${hasPreview(tile.preview) ? renderPreview(tile.preview, ctx.draft) : ""}
    ${kept ? "" : bernard(tile.lines.sayNext)}
    <div class="wb-out">
      ${kept ? "" : `<button type="button" class="btn btn-primary wb-cta" data-go="keep">Publish it →</button>`}
      <button type="button" class="inline-link" id="fix">${kept ? "Change something" : "Fix something first"}</button>
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
