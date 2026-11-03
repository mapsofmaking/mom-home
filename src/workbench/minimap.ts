/**
 * A small real map behind a card (14.4 S6, #16): the card preview of tile A and the
 * threshold's pin read back from the map. One pin, still, centred under the card.
 *
 * MapLibre is loaded only when a frame with a slot is drawn (a separate chunk), and the
 * page works without it: no WebGL, a failed load or no tiles leave the frame's paper
 * background, which is what was there before. The map is decoration for sighted readers
 * (aria-hidden); the card and the pin line beside it say the same in words.
 *
 * The basemap is the map's own at street zoom (mapsofmaking.org, web/app.js buildStyle,
 * light end): OpenFreeMap vector tiles, no labels, so no glyphs are fetched.
 */
import type { StyleSpecification } from "maplibre-gl";
import { esc } from "./html";

/** The street zoom the map itself opens a space at (?lat&lon → z13), one step closer. */
const ZOOM = 14;
/** Room left at the top for the card, so the pin sits below it. */
const CARD_ROOM = 96;

const ok = (v: number) => Number.isFinite(v);

/** The map's slot, or nothing when there is no pin to centre on. */
export function miniMapSlot(lat: number | string | undefined, lon: number | string | undefined): string {
  const la = Number(lat);
  const lo = Number(lon);
  if (lat === undefined || lon === undefined || lat === "" || lon === "" || !ok(la) || !ok(lo)) return "";
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return "";
  return `<div class="wb-map" aria-hidden="true" data-lat="${esc(String(la))}" data-lon="${esc(String(lo))}"></div>`;
}

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    ofm: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> © <a href="https://openfreemap.org">OpenFreeMap</a>',
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#e8e8e8" } },
    { id: "landuse", type: "fill", source: "ofm", "source-layer": "landuse", paint: { "fill-color": "#e8e8e8", "fill-opacity": 0.4 } },
    { id: "water", type: "fill", source: "ofm", "source-layer": "water", paint: { "fill-color": "#c0d0d8" } },
    {
      id: "roads", type: "line", source: "ofm", "source-layer": "transportation",
      paint: { "line-color": "#bbbbbb", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.6, 16, 3] },
    },
    { id: "buildings", type: "fill", source: "ofm", "source-layer": "building", paint: { "fill-color": "#d0d0d0", "fill-opacity": 0.8 } },
  ],
};

interface Live {
  el: HTMLElement;
  remove(): void;
}
const live: Live[] = [];

/** No WebGL (old browser, test runner): the frame keeps its paper. */
const canDraw = () => typeof window !== "undefined" && typeof window.WebGLRenderingContext !== "undefined";

/** Maps whose frame was redrawn away are removed: a redraw never stacks a second WebGL context. */
export function dropGoneMaps(): void {
  for (let i = live.length - 1; i >= 0; i--) {
    if (!live[i].el.isConnected) {
      live[i].remove();
      live.splice(i, 1);
    }
  }
}

export function dropAllMaps(): void {
  live.splice(0).forEach((m) => m.remove());
}

/** Draws a map into each new slot under `root`. Never throws: a map that can't be drawn is left out. */
export async function mountMiniMaps(root: ParentNode): Promise<void> {
  dropGoneMaps();
  const slots = [...root.querySelectorAll<HTMLElement>(".wb-map[data-lat]:not([data-drawn])")];
  if (!slots.length || !canDraw()) return;
  slots.forEach((s) => s.setAttribute("data-drawn", ""));
  try {
    const [{ default: maplibregl }] = await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")]);
    for (const el of slots) {
      if (!el.isConnected) continue;
      const center: [number, number] = [Number(el.dataset.lon), Number(el.dataset.lat)];
      const map = new maplibregl.Map({
        container: el,
        style: STYLE,
        center,
        zoom: ZOOM,
        interactive: false,
        attributionControl: { compact: true },
        fadeDuration: 0,
      });
      map.setPadding({ top: CARD_ROOM, bottom: 0, left: 0, right: 0 });
      const dot = document.createElement("span");
      dot.className = "wb-map-pin";
      new maplibregl.Marker({ element: dot }).setLngLat(center).addTo(map);
      live.push({ el, remove: () => map.remove() });
    }
  } catch (err) {
    console.warn("The small map behind the card could not be drawn; the card stands on its own:", err);
  }
}
