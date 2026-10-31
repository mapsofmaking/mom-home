/**
 * The folded hex view (Story 14.1 AC7, design system: HexRow): one line of
 * small hexes, the tiles reached so far in prio order, then "+ N to
 * discover", "Now: <step>" and "Show all", which unfolds the full view in
 * place (page.ts: the toggle).
 *
 * One component in both modes, the design system's HexRow toolbar (`.hx-bar`,
 * 52px; it wraps on a phone): done and open tiles carry their TilePicto
 * (`onb:icon`), coming tiles stay dashed and empty, the tile name shows on
 * hover or focus, a click opens the tile. The picto is how a tile is known
 * once folded, signed in or not (Nicolas, 2026-10-31).
 *
 * "+ N to discover" is also where new tiles and features show up as they are
 * built: the count grows, nothing else changes.
 *
 * On a phone (14.2 S5, storyboard "A1 on a phone"), the toolbar gives way to
 * a slim strip: one button, the whole width, that unfolds the full view. Up to
 * six hexes, then "+N" and "See all". The hexes in it are not separate targets
 * (26px hexes are too small to tap). home.css picks one of the two by width.
 */
import type { TileState } from "../tree/fog";
import type { Tile } from "../tree/parse";
import { esc } from "./html";
import { HEX_H, HEX_POINTS, HEX_W } from "./hexview";
import { ICONS } from "./icons";

function name(tile: Tile, state: TileState): string {
  return state === "cue" || state === "ready" ? `Coming: ${tile.cue}` : tile.title;
}

/** The hex and its picto, shared by the toolbar and the phone strip: done and open tiles carry their picto. */
function hexBody(tile: Tile, state: TileState): string {
  const icon = (state === "done" || state === "open") && Object.hasOwn(ICONS, tile.icon ?? "") ? ICONS[tile.icon!] : null;
  return `<svg class="hex" viewBox="0 0 ${HEX_W} ${HEX_H}" aria-hidden="true">
      <polygon class="hx-tint" points="${HEX_POINTS}"/>
      <polygon class="hx-shape" points="${HEX_POINTS}"/>
    </svg>${icon ? `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="${icon}"/></svg>` : ""}`;
}

const hexClass = (state: TileState) => (state === "ready" ? "cue" : state);

function hex(tile: Tile, state: TileState, selected: boolean): string {
  const label = name(tile, state);
  return `<button type="button" class="hx tool ${hexClass(state)}" data-tile="${esc(tile.id)}"
      ${selected ? `aria-current="step"` : ""} aria-label="${esc(label)}${state === "done" ? ", done" : ""}">
    ${hexBody(tile, state)}
    <span class="tip below" aria-hidden="true">${esc(label)}</span>
  </button>`;
}

/** At most this many hexes in the phone's strip; the rest is counted. */
const COMPACT_MAX = 6;

/** A hex in the phone strip: not a target of its own (the strip is one button). */
const pip = (tile: Tile, state: TileState, selected: boolean) =>
  `<span class="hx tool ${hexClass(state)}"${selected ? ` data-current` : ""}>${hexBody(tile, state)}</span>`;

function compactRow(tiles: readonly Tile[], states: ReadonlyMap<string, TileState>, selected: string): string {
  const reached = tiles.filter((t) => (states.get(t.id) ?? "fog") !== "fog");
  const rest = tiles.length - Math.min(reached.length, COMPACT_MAX);
  const pips = reached.slice(0, COMPACT_MAX).map((t) => pip(t, states.get(t.id)!, t.id === selected)).join("");
  const label = `What you can do: ${reached.length} reached, ${tiles.length - reached.length} to discover. See all`;
  return `<button type="button" class="hx-bar compact" data-unfold aria-expanded="false" aria-label="${esc(label)}">${pips}${
    rest ? `<span class="hx-more">+${rest}</span>` : ""
  }<span class="hx-see">See all ›</span></button>`;
}

export function renderHexRow(
  tiles: readonly Tile[],
  states: ReadonlyMap<string, TileState>,
  selected: string
): string {
  const reached = tiles.filter((t) => (states.get(t.id) ?? "fog") !== "fog");
  const toDiscover = tiles.length - reached.length;
  const now = tiles.find((t) => t.id === selected);
  const hexes = reached.map((t) => hex(t, states.get(t.id)!, t.id === selected)).join("");
  const more = toDiscover ? `<span class="hx-more">+ ${toDiscover} to discover</span>` : "";
  const nowLine = `<span class="hx-now"><span><span class="k">Now:</span> <b>${esc(
    now ? name(now, states.get(now.id) ?? "fog") : ""
  )}</b></span> <button type="button" class="btn wb-fold" id="unfold" data-unfold aria-expanded="false">Show all</button></span>`;

  return `<nav class="hx-bar full" aria-label="What you can do"><span class="k">What you can do</span>${hexes}${more}${nowLine}</nav>${compactRow(
    tiles,
    states,
    selected
  )}`;
}
