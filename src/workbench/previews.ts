/**
 * What each tile would give, keyed by the tree's `onb:preview` (Story 14.1
 * AC6). Concept screens as data (kit ux-principles.md): one function per
 * kind, built only from what the coordinator typed, so a preview never shows
 * a name or a reader that isn't real (design system: Workbench, Honesty
 * rules). Nothing typed yet, it says so in place: "Your space".
 *
 * A network (2026-11-19) says "Your network" instead, and where a space's card
 * names its town, a network's says the area it serves ("Serves Flanders").
 * Those words are the tree's (`PreviewWords`, tile A's `onb:ui*` lines).
 *
 * Copy reference: the dry run's PREVIEWS ("Maps of Making Dry Run").
 */
import { esc } from "./html";
import { miniMapSlot } from "./minimap";
import type { Area } from "../lib/spacefile";

/** What the coordinator has typed so far. Signed out it lives in memory (AC4). */
export interface Draft {
  /**
   * What the file describes (2026-11-19): a space (a place with an address), or a network (it serves an area,
   * and has no address). Absent is a space, so every draft from before reads as it did.
   */
  kind?: "space" | "network";
  /** A network's areas: an ISO 3166 code (`BE`, `BE-VLG`) and its name ("Flanders"), searched by name; a space has none. */
  areaServed?: Area[];
  /** How coarse the pin is (`region`, `country` for a network at its area's centre); the geocoder says it. */
  fidelity?: string;
  name?: string;
  street?: string;
  city?: string;
  /** Worked out by the geocoder (where.ts), or typed by hand when it found nothing. */
  country?: string;
  postcode?: string;
  lat?: string;
  lon?: string;
  /** The place the geocoder found, short ("Anderlecht, Brussel-Hoofdstad, 1070"). */
  place?: string;
  description?: string;
  email?: string;
  matrix?: string;
  website?: string;
  logo?: string;
  /** Tile C's (14.6): tile A doesn't ask for hours. */
  hours?: string;
  /**
   * The networks this space names (#73): IRIs the map reads (`urn:mak:network/<slug>`, or http(s)), from an
   * imported file. Declared, not recognised: no preview shows them as a name (an IRI is not one).
   */
  memberOf?: string[];
  /** The UN goals it works on, 1 to 17 (an import's `mom.sdgs`). */
  sdgs?: number[];
  /** Its topics (an import's `knowsAbout`). */
  knowsAbout?: string[];
  /** "file": the pin is the imported file's own (#73); typing a missing country then doesn't ask the geocoder again. */
  pinFrom?: "file";
  /** What an import found in the file and the draft can't hold (tile A says so, #73): keys, or "key: value". */
  notCarried?: string[];
  event?: { title: string; date: string };
}

/** The tree's words a network's preview needs (tile A's: describe.ts `previewWords`). */
export interface PreviewWords {
  /** "Your network": a network's name until one is typed. */
  yourNetwork: string;
  /** The hours row's name on a card: "Hours", and for a network "Contact hours" (the tree's, by kind). */
  hoursFact: string;
  /** "Serves Flanders": the areas named; "" when none is picked yet. */
  serves(d: Draft): string;
  /** The areas named, joined ("Flanders, Brussels"). */
  areas(d: Draft): string;
}

type W = PreviewWords | null;
const isNet = (d: Draft) => d.kind === "network";

const name = (d: Draft, w: W = null) => esc(d.name || (isNet(d) ? (w?.yourNetwork ?? "") : "Your space"));
/** Where a card says it is: the town for a space, the areas served for a network. */
const where = (d: Draft, w: W) => (isNet(d) ? (w?.areas(d) ?? "") : (d.city ?? ""));
const network = (_d: Draft) => "your network";
const dash = `<em class="pv-empty">—</em>`;

const facts = (rows: [string, string | undefined][]) =>
  `<dl class="pv-facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v ? esc(v) : dash}</dd>`).join("")}</dl>`;

const PREVIEWS: Record<string, (d: Draft, w: W) => string> = {
  mapcard: (d, w) => `
    <div class="wb-frame">
      ${miniMapSlot(d.lat, d.lon)}
      <div class="wb-popup">
        <div class="sp-hero"><span class="sp-name hand">${name(d, w)}</span>
          <span class="sp-address">${isNet(d) ? esc(w?.serves(d) ?? "") : esc(d.city) || "Where you are"}</span></div>
        <div class="wb-popup-foot">Open on mapsofmaking.org ↗</div>
      </div>
    </div>
    ${facts([["Description", d.description], [w?.hoursFact ?? "Hours", d.hours], ["Next event", d.event && `${d.event.title} · ${d.event.date}`]])}`,
  kept: (d, w) => `
    <div class="pv">
      <p class="pv-title">${name(d, w)}</p>
      <p class="pv-meta">On the map, read from your own file. Anyone looking in ${esc(where(d, w)) || "your town"} finds you.</p>
    </div>`,
  readers: (d, w) => `
    <div class="pv">
      <p class="pv-title">Who reads your file</p>
      ${facts([["The map", "mapsofmaking.org"], [w?.hoursFact ?? "Hours", d.hours]])}
      <p class="pv-meta">One edit, read by each of them. Nothing to retype.</p>
    </div>`,
  network: (d, w) => `
    <div class="pv">
      <p class="pv-title">${name(d, w)}</p>
      <p><span class="pv-chip declared">${network(d)}</span></p>
      <p class="pv-meta">Declared by ${name(d, w)}. Your network hasn't recognised it yet.</p>
    </div>`,
  assistant: (d, w) => `
    <div class="pv">
      <p class="pv-q">Can a beginner just turn up?</p>
      <p class="pv-a">${esc(d.description || `${d.name || (isNet(d) ? (w?.yourNetwork ?? "") : "Your space")} doesn't say yet.`)}</p>
      <p class="pv-log">What was read: space.ttl, and nothing else</p>
    </div>`,
  ohm: (d, w) => `
    <div class="pv">
      <p class="pv-meta">Also listed on</p>
      <p class="pv-title">Open Hardware Manager</p>
      <p class="pv-meta">${name(d, w)}${where(d, w) ? ` · ${esc(where(d, w))}` : ""}. It reads the same index as the map.</p>
    </div>`,
  peers: (d, w) => `
    <div class="pv">
      <p class="pv-title">Your network</p>
      <p class="pv-meta">Members both sides recognise</p>
      <p><span class="pv-chip">${name(d, w)}</span> <span class="pv-meta">and the other members, from their own files</span></p>
    </div>`,
  agenda: (d, w) => `
    <div class="pv">
      <p class="pv-title">Your network · agenda</p>
      <p class="pv-meta">${d.event ? `${esc(d.event.date)} · ${esc(d.event.title)} at ${name(d, w)}` : `Your events, beside your peers'.`}</p>
    </div>`,
  handover: (d, w) => `
    <div class="pv">
      <p class="pv-title">Account</p>
      <p class="pv-meta">The space's mailbox. The next coordinator resets the passphrase from it; ${name(d, w)}, its file and its memberships stay put.</p>
    </div>`,
};

export function hasPreview(kind: string | null): kind is string {
  return kind !== null && Object.hasOwn(PREVIEWS, kind);
}

/** A preview, always framed and labelled: it never passes for the real thing (AC6). */
export function renderPreview(kind: string, draft: Draft, w: PreviewWords | null = null): string {
  return `
    <section class="wb-preview" aria-label="Preview">
      <p class="wb-frame-label"><span>What you'd get</span><span>Preview · nothing is published</span></p>
      ${PREVIEWS[kind](draft, w)}
    </section>`;
}
