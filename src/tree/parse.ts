/**
 * Reads the tile tree, `public/onboarding.ttl`, into tiles, words and the
 * app's own lines (Story 14.1 AC2).
 *
 * The file is the single source of every line Bernard speaks in the app, so
 * lines are not a fixed list of fields here: every `onb:say*` and `onb:said*`
 * literal on a tile or on the `onb:App` is kept under its local name
 * (`say`, `saidDone`, `sayPod`, ...). A new line is an edit to the Turtle,
 * never to this file. Forking the app for another vertical means swapping
 * that one file.
 *
 * A tree that breaks a rule the app depends on (a requirement naming no tile,
 * two tiles in one hex, a tile with no cue) is refused with a TreeError
 * naming the tile: a half-read tree would draw a map that lies. `onb:level`
 * is not read (dropped, AC2); `onb:doneWhen` is kept as documentation only
 * (AC4).
 *
 * The app's own words for a tile (Story 14.2 AC8) live there too, apart from
 * Bernard's: `onb:ui*` lines (buttons, messages) under their local name
 * (`uiCta`, `uiPinFound`), and `onb:field` nodes, one per
 * form field, keyed by `onb:key`. The code keeps what a field does (type,
 * required); the tree keeps what it says.
 */
import { Parser, type Quad, type Term } from "n3";

export const ONB = "https://mapsofmaking.org/ns/onboarding#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/** Bernard's lines by local name: `say`, `saidDone`, `sayNext`, ... */
export type Lines = Readonly<Record<string, string>>;

export interface Tile {
  id: string;
  /** The tile's IRI in the tree, as settings/mom-home.ttl names it. */
  iri: string;
  title: string;
  cue: string;
  /** Hex position, hand-placed (docs/explanation/home-hex-view.md in maps_of_making). */
  q: number;
  r: number;
  prio: number;
  requiresAll: string[];
  requiresAny: string[];
  needsPod: boolean;
  /** Drawn but never opens: it appears when people start doing it. */
  emergent: boolean;
  /** Drawn but never opens: not built yet. */
  planned: boolean;
  act: string;
  preview: string | null;
  icon: string | null;
  /** The tile's opening line in the app's own voice, not Bernard's (tile A: no guide yet). */
  lead: string | null;
  /** The lead on a phone, shorter (14.2 AC2); the full lead when there is none. */
  leadShort: string | null;
  unlocksWord: string | null;
  lines: Lines;
  /** The app's own words on this tile: `uiCta`, `uiPinFound`, ... (14.2 AC8). */
  ui: Lines;
  /** The tile's form fields' words, by `onb:key`. */
  fields: Readonly<Record<string, FieldWords>>;
  doneWhen: string | null;
}

/** What a form field says (14.2 AC8). The code keeps what it does. */
export interface FieldWords {
  label: string;
  placeholder: string | null;
  hint: string | null;
  /** "Fill in an example": a space that doesn't exist. */
  example: string | null;
}

export interface Word {
  id: string;
  label: string;
  meaning: string;
  prio: number;
}

export interface Tree {
  /** The app's own: Bernard's lines, and `onb:ui*` words (the work-in-progress notice). */
  app: { lines: Lines; ui: Lines };
  tiles: Tile[];
  words: Word[];
}

/** The tree can't be used. `message` is for the coordinator's error screen's detail. */
export class TreeError extends Error {
  name = "TreeError";
}

type Props = Map<string, Term[]>;

const local = (iri: string): string => iri.slice(iri.lastIndexOf("#") + 1);

/**
 * The literal to show: English first, then untagged, then whatever there is.
 * The tree is tagged @en today; reading both shapes keeps an untagged edit
 * from blanking a line (the trap src/lib/literal.ts describes).
 */
function text(terms: Term[] | undefined): string | null {
  if (!terms?.length) return null;
  const literals = terms.filter((t) => t.termType === "Literal");
  const lang = (t: Term) => (t.termType === "Literal" ? t.language : "");
  const pick =
    literals.find((t) => lang(t) === "en") ?? literals.find((t) => lang(t) === "") ?? literals[0];
  return pick ? pick.value : null;
}

function lines(props: Props, prefix = /^(say|said)([A-Z]|$)/): Lines {
  const out: Record<string, string> = {};
  for (const [p, terms] of props) {
    if (!p.startsWith(ONB)) continue;
    const name = local(p);
    if (!prefix.test(name)) continue;
    const value = text(terms);
    if (value !== null) out[name] = value;
  }
  return out;
}

/** A tile's `onb:field` nodes, by key. A field with no key or no label is refused: it would draw a blank. */
function fieldsOf(tile: string, terms: Term[], subjects: Map<string, Props>): Record<string, FieldWords> {
  const out: Record<string, FieldWords> = {};
  for (const term of terms) {
    const props = subjects.get(term.value);
    const get = (name: string) => text(props?.get(ONB + name));
    const key = get("key");
    const label = get("label");
    if (!key || !label) throw new TreeError(`Tile "${tile}" has a field with no onb:key or no onb:label.`);
    if (out[key]) throw new TreeError(`Tile "${tile}" has two fields called "${key}".`);
    out[key] = { label, placeholder: get("placeholder"), hint: get("hint"), example: get("example") };
  }
  return out;
}

export function parseTree(turtle: string): Tree {
  let quads: Quad[];
  try {
    quads = new Parser().parse(turtle);
  } catch (e) {
    throw new TreeError(`onboarding.ttl is not valid Turtle: ${(e as Error).message}`);
  }

  const subjects = new Map<string, Props>();
  for (const q of quads) {
    const props = subjects.get(q.subject.value) ?? new Map<string, Term[]>();
    subjects.set(q.subject.value, props);
    const list = props.get(q.predicate.value) ?? [];
    list.push(q.object);
    props.set(q.predicate.value, list);
  }

  const tiles: Tile[] = [];
  const words: Word[] = [];
  let app: Tree["app"] = { lines: {}, ui: {} };

  for (const [iri, props] of subjects) {
    const types = (props.get(RDF_TYPE) ?? []).map((t) => t.value);
    const id = local(iri);
    const get = (name: string) => text(props.get(ONB + name));
    const iris = (name: string) => (props.get(ONB + name) ?? []).map((t) => local(t.value));
    const need = (name: string, kind: string): string => {
      const value = get(name);
      if (value === null) throw new TreeError(`${kind} "${id}" has no onb:${name}.`);
      return value;
    };
    const num = (name: string, kind: string, integer = false): number => {
      const raw = need(name, kind).trim();
      // Number("") is 0: a blank value would silently place a tile at 0,0.
      const value = raw === "" ? NaN : Number(raw);
      if (!Number.isFinite(value)) throw new TreeError(`${kind} "${id}": onb:${name} is not a number.`);
      if (integer && !Number.isInteger(value)) throw new TreeError(`${kind} "${id}": onb:${name} must be a whole number.`);
      return value;
    };

    if (types.includes(ONB + "Tile")) {
      tiles.push({
        id,
        iri,
        title: need("title", "Tile"),
        cue: need("cue", "Tile"),
        q: num("q", "Tile", true),
        r: num("r", "Tile", true),
        prio: num("prio", "Tile"),
        requiresAll: iris("requiresAll"),
        requiresAny: iris("requiresAny"),
        needsPod: get("needsPod") === "true",
        emergent: get("emergent") === "true",
        planned: get("planned") === "true",
        act: get("act") ?? "none",
        preview: get("preview"),
        icon: get("icon"),
        lead: get("lead"),
        leadShort: get("leadShort"),
        unlocksWord: iris("unlocksWord")[0] ?? null,
        lines: lines(props),
        ui: lines(props, /^ui[A-Z]/),
        fields: fieldsOf(id, props.get(ONB + "field") ?? [], subjects),
        doneWhen: get("doneWhen"),
      });
    } else if (types.includes(ONB + "Word")) {
      words.push({
        id,
        label: need("label", "Word"),
        meaning: need("meaning", "Word"),
        prio: num("prio", "Word"),
      });
    } else if (types.includes(ONB + "App")) {
      app = { lines: lines(props), ui: lines(props, /^ui[A-Z]/) };
    }
  }

  if (tiles.length === 0) throw new TreeError("onboarding.ttl has no onb:Tile.");

  const tileIds = new Set<string>();
  for (const t of tiles) {
    // Two IRIs with the same fragment would collapse into one id and hide a tile.
    if (tileIds.has(t.id)) throw new TreeError(`Two tiles are called "${t.id}".`);
    if (t.emergent && t.planned) throw new TreeError(`Tile "${t.id}" is both emergent and planned.`);
    tileIds.add(t.id);
  }
  const wordIds = new Set(words.map((w) => w.id));
  const cells = new Map<string, string>();
  for (const t of tiles) {
    for (const req of [...t.requiresAll, ...t.requiresAny]) {
      if (!tileIds.has(req)) throw new TreeError(`Tile "${t.id}" requires "${req}", which is not a tile.`);
    }
    if (t.unlocksWord && !wordIds.has(t.unlocksWord)) {
      throw new TreeError(`Tile "${t.id}" unlocks "${t.unlocksWord}", which is not a word.`);
    }
    const cell = `${t.q},${t.r}`;
    const other = cells.get(cell);
    if (other) throw new TreeError(`Tiles "${other}" and "${t.id}" share the hex at q=${t.q}, r=${t.r}.`);
    cells.set(cell, t.id);
  }

  // A tile can open only if everything it needs can be done: a cycle, or no starting
  // tile, would draw fog that never lifts.
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const openable = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of tiles) {
      if (openable.has(t.id)) continue;
      const all = t.requiresAll.every((id) => openable.has(id));
      const any = t.requiresAny.length === 0 || t.requiresAny.some((id) => openable.has(id));
      if (all && any) {
        openable.add(t.id);
        grew = true;
      }
    }
  }
  // Emergent and planned tiles never open, but can be done (by data, once people do it), so others may require them.
  if (!tiles.some((t) => !t.emergent && !t.planned && openable.has(t.id))) {
    throw new TreeError("No tile can open: none is free of requirements.");
  }
  for (const t of tiles) {
    if (t.emergent || t.planned || openable.has(t.id)) continue;
    const stuck = [...t.requiresAll, ...t.requiresAny].filter((id) => !openable.has(id) && byId.get(id));
    throw new TreeError(`Tile "${t.id}" can never open (needs ${stuck.join(", ") || "a cycle"}).`);
  }

  tiles.sort((a, b) => a.prio - b.prio);
  words.sort((a, b) => a.prio - b.prio);
  return { app, tiles, words };
}
