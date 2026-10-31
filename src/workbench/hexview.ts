/**
 * "What you can do": the full hex view (Story 14.1 AC7), drawn with the
 * design system's HexTile (`.hx`, tokens/workbench.css).
 *
 * Tiles sit where the tree puts them (`onb:q`/`onb:r`, axial, pointy-top;
 * placement rules in maps_of_making docs/explanation/home-hex-view.md). Each
 * tile is a button except fog: still to discover is halftone dots, no label,
 * nothing to click, read once as "still to discover" by a screen reader.
 */
import type { TileState } from "../tree/fog";
import type { Tile } from "../tree/parse";
import { esc } from "./html";

/** HexTile's box (tokens/workbench.css `.hx`): 104 × 120, pointy-top. */
export const HEX_W = 104;
export const HEX_H = 120;
/** Centre-to-centre spacing: a hairline of paper between neighbours. */
const SIZE = 63;

export const HEX_POINTS = "52,2 102,31 102,89 52,118 2,89 2,31";

/** Top-left corner of a tile's box, before the view is shifted to start at 0,0. */
export function hexPosition(q: number, r: number): { x: number; y: number } {
  return { x: SIZE * Math.sqrt(3) * (q + r / 2), y: SIZE * 1.5 * r };
}

/** What a tile shows: its title once open or done, its cue while coming, nothing in the fog. */
export function tileLabel(tile: Tile, state: TileState): string {
  if (state === "done" || state === "open") return tile.title;
  if (state === "cue" || state === "ready") return tile.cue;
  return "";
}

function ariaLabel(tile: Tile, state: TileState): string {
  switch (state) {
    case "done":
      return `${tile.title}, done`;
    case "open":
      return `${tile.title}, you can do it now`;
    case "ready":
      return `Coming: ${tile.cue}, ready`;
    case "cue":
      return `Coming: ${tile.cue}`;
    default:
      return "Still to discover";
  }
}

export function renderHexView(
  tiles: readonly Tile[],
  states: ReadonlyMap<string, TileState>,
  selected: string | null
): string {
  const placed = tiles.map((t) => ({ t, ...hexPosition(t.q, t.r) }));
  const minX = Math.min(...placed.map((p) => p.x));
  const minY = Math.min(...placed.map((p) => p.y));
  const width = Math.max(...placed.map((p) => p.x)) - minX + HEX_W;
  const height = Math.max(...placed.map((p) => p.y)) - minY + HEX_H;

  const cells = placed
    .map(({ t, x, y }) => {
      const state = states.get(t.id) ?? "fog";
      const style = `left:${(x - minX).toFixed(1)}px;top:${(y - minY).toFixed(1)}px`;
      if (state === "fog") {
        return `<span class="hx fog" style="${style}" aria-hidden="true"></span>`;
      }
      // "ready" draws as a cue: it is coming, and says why in the step panel.
      const cls = state === "ready" ? "cue" : state;
      const current = t.id === selected ? ` aria-current="step"` : "";
      return `<button type="button" class="hx ${cls}" style="${style}" data-tile="${esc(t.id)}"${current}
          aria-label="${esc(ariaLabel(t, state))}">
        <svg viewBox="0 0 ${HEX_W} ${HEX_H}" aria-hidden="true">
          <polygon class="hx-tint" points="${HEX_POINTS}"/>
          <polygon class="hx-shape" points="${HEX_POINTS}"/>
        </svg>
        ${state === "done" ? `<span class="hx-tick" aria-hidden="true">✓</span>` : ""}
        <span class="hx-label" aria-hidden="true">${esc(tileLabel(t, state))}</span>
      </button>`;
    })
    .join("");

  const fogCount = [...states.values()].filter((s) => s === "fog").length;
  return `<div class="hx-view" style="width:${width.toFixed(0)}px;height:${height.toFixed(0)}px">${cells}</div>
    ${fogCount ? `<p class="visually-hidden">${fogCount} more still to discover.</p>` : ""}`;
}
