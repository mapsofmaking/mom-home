/**
 * The space file: the Turtle written at the pod root from what tile A collected
 * (Story 14.4 AC2). The fields and their mapping are
 * maps_of_making `docs/reference/space-file.md` (the Turtle column); the map's
 * reading of it is Story 14.7, and `test/fixtures/atelier-du-canal.ttl` (pinned,
 * see its README) holds this writer to that reading.
 *
 * Deterministic: the same draft gives the same text, no clock, no random.
 *
 * The draft is typed by a person into a form, so every value is untrusted on its
 * way into Turtle: strings are escaped, IRIs must be plain http(s) with nothing
 * that could end the IRI, and a value that can't be made safe is left OUT and
 * reported in `dropped`, never written as it was typed. The three things a card
 * cannot do without (a name, a town and country, a pin) are required: without
 * them there is no file to write.
 *
 * A network (2026-11-19, the map's "A network" section of the same reference) has no address: it serves an
 * area. Its node is typed `mom:Network, schema:Organization` (the subject stays `<#space>`), says each area in
 * a `schema:areaServed` node of its own (`schema:AdministrativeArea`, its ISO code as `schema:identifier` and
 * its name), and sits at the area's centre with `mom:geolocationFidelity` saying how
 * coarse that pin is. Required for a network: a name, an area, a pin. `test/fixtures/maakbib.ttl` holds it.
 */
import { Parser, type Quad, type Term } from "n3";
import type { Draft } from "../workbench/previews";

const SCHEMA = "https://schema.org/";
const MOM = "https://mapsofmaking.org/ns/mom#";

export type SpaceFileProblem = "name" | "town" | "country" | "pin" | "area";

/** A draft that is not yet enough for a card: which of the required parts is missing. */
export class SpaceFileError extends Error {
  readonly missing: SpaceFileProblem[];
  constructor(missing: SpaceFileProblem[]) {
    super(`The description is not complete: missing ${missing.join(", ")}.`);
    this.name = "SpaceFileError";
    this.missing = missing;
  }
}

export interface SpaceFile {
  turtle: string;
  /** Draft fields left out of the file because their value was not a web address. */
  dropped: ("website" | "logo" | "matrix")[];
}

/** A Turtle string literal: quotes, backslashes and control characters escaped. */
export function literal(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    // Any other control character becomes its unicode escape, so no byte can end or bend the statement.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `"${escaped}"`;
}

/**
 * A plain http(s) IRI as `<…>`, or null. Nothing that could end the IRI or start
 * another token (angle brackets, quotes, braces, spaces, control characters,
 * backslash, caret, backtick, pipe) survives: an address that has them is not
 * one this file will carry.
 */
export function iri(value: string | undefined): string | null {
  const href = plainIri(value);
  return href ? `<${href}>` : null;
}

/** The same check as `iri`, without the angle brackets: the address itself (the SpaceAPI writer uses it). */
export function plainIri(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // eslint-disable-next-line no-control-regex
  if (/[<>"{}|\\^`\s\u0000-\u001f\u007f]/.test(url.href)) return null;
  return url.href;
}

/** `#room:server` as the link the map shows: matrix.to with the leading symbol encoded, colons kept. */
export function matrixLink(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return iri(text);
  if (!/^[#!@+][^\s:]+:[^\s]+$/.test(text)) return null;
  return iri(`https://matrix.to/#/${encodeURIComponent(text).replace(/%3A/gi, ":")}`);
}

/** `https://matrix.to/#/<room>` back to the room as typed (`#room:server`); null for any other address. */
export function matrixRoom(value: string | undefined): string | null {
  const link = matrixLink(value);
  const room = link ? /^<https:\/\/matrix\.to\/#\/(.+)>$/.exec(link)?.[1] : undefined;
  return room ? decodeURIComponent(room) : null;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** An ISO 3166-1 alpha-2 country (`BE`) or an ISO 3166-2 subdivision (`BE-VLG`): the map's area codes. */
export const AREA_CODE = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;
/** The ontology's fidelity values (the map leaves any other out). Never "street". */
export const FIDELITIES = ["exact", "approximate", "city", "region", "country"] as const;
const MAX_AREAS = 10;

/** An area a network serves (2026-11-19): its ISO code, and its name as the geocoder gave it ("" when unknown). */
export interface Area {
  code: string;
  name: string;
}

/** The longest name an area keeps (the map's MAX_AREA_NAME): a longer one is cut there, as the map cuts it. */
const MAX_AREA_NAME = 200;

/**
 * An area's name as the map cleans it (maps_of_making `scripts/spaceapi_extract/area.py` `clean_area_name`):
 * control characters out, whitespace runs to one space, trimmed, cut at 200 characters; "" when none. It comes
 * from the geocoder, not from a person, so cutting loses no authored copy.
 */
export function cleanAreaName(value: unknown): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const line = value.replace(/[\u0000-\u001f\u007f]/g, " ").split(/\s+/).filter(Boolean).join(" ");
  // Cut by character (Python slices code points), not by UTF-16 unit.
  return Array.from(line).slice(0, MAX_AREA_NAME).join("");
}

/**
 * Areas as the map keeps them (`clean_areas`): valid codes only (upper case), once each, sorted by code, ten at
 * most. Takes `{code, name}` and a bare code string (a draft or file from #67, name ""); anything else is
 * dropped. Two of one code: a name beats none, then the smaller name, so the same file always reads the same.
 */
export function cleanAreas(areas: readonly unknown[] | undefined): Area[] {
  const best = new Map<string, string>();
  for (const a of Array.isArray(areas) ? areas : []) {
    const raw = typeof a === "string" ? { code: a, name: "" } : a && typeof a === "object" ? (a as Record<string, unknown>) : null;
    if (!raw || typeof raw.code !== "string") continue;
    const code = raw.code.trim().toUpperCase();
    if (!AREA_CODE.test(code)) continue;
    const name = cleanAreaName(raw.name);
    const had = best.get(code);
    if (had === undefined || (name && (!had || name < had))) best.set(code, name);
  }
  return [...best.keys()].sort().slice(0, MAX_AREAS).map((code) => ({ code, name: best.get(code)! }));
}

/**
 * The subdivisions the map names when a file doesn't (maps_of_making web/app.js `AREA_NAMES`): kept in step
 * with the map's fallback, so a nameless area from a #67 file reads the same on both sides.
 */
const AREA_NAMES: Readonly<Record<string, string>> = { "BE-VLG": "Flanders", "BE-WAL": "Wallonia", "BE-BRU": "Brussels" };

/**
 * An area as people read it, as the map labels it: its name; without one, the map's name for a subdivision it
 * knows, the country's English name for a country code, else the code.
 */
export function areaLabel(area: Area): string {
  if (area.name) return area.name;
  if (AREA_NAMES[area.code]) return AREA_NAMES[area.code];
  if (/^[A-Z]{2}$/.test(area.code)) {
    try {
      return new Intl.DisplayNames(["en"], { type: "region" }).of(area.code) ?? area.code;
    } catch {
      return area.code;
    }
  }
  return area.code;
}

/** The one country all the areas are in (`BE-VLG`, `BE-BRU` → `BE`); null when they span several, or none. */
export function areasCountry(areas: readonly Area[]): string | null {
  const countries = new Set(areas.map((a) => a.code.slice(0, 2)));
  return countries.size === 1 ? [...countries][0] : null;
}

/** How coarse a pin at an area's centre is: a subdivision is a region, a country a country. */
export const areaFidelity = (area: string): "region" | "country" => (area.includes("-") ? "region" : "country");

/** A fidelity the map reads, or null. */
export const cleanFidelity = (value: string | undefined): string | null => {
  const v = (value ?? "").trim().toLowerCase();
  return (FIDELITIES as readonly string[]).includes(v) ? v : null;
};

export const isNetwork = (draft: Pick<Draft, "kind">) => draft.kind === "network";

/** A network on the map: `urn:mak:network/<slug>` (the map's `safe_iri(networks=True)`). */
const NETWORK_IRI = /^urn:mak:network\/[a-z0-9_-]{1,64}$/;
const MAX_LIST = 50;
const MAX_TOPIC = 200;

/**
 * A network a space names (#73): `urn:mak:network/<slug>`, or a plain http(s) IRI (a collective's config.ttl);
 * a bare slug ("maakbib") is the map's `urn:mak:network/maakbib`. null for anything else (`javascript:`, a
 * space, an IRI with what could end it): the map's own check, so home never writes what the map would drop.
 */
export function memberIri(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (!text.includes(":")) return memberIri(`urn:mak:network/${text.toLowerCase()}`);
  if (NETWORK_IRI.test(text)) return text;
  return /^https?:/i.test(text) ? plainIri(text) : null;
}

/** The networks, as IRIs the map reads: once each, in the order given, at most 50. */
export function cleanMemberOf(values: readonly unknown[] | undefined): string[] {
  const out: string[] = [];
  for (const v of Array.isArray(values) ? values : []) {
    const iri = memberIri(v);
    if (iri && !out.includes(iri)) out.push(iri);
  }
  return out.slice(0, MAX_LIST);
}

/** The UN goals, 1 to 17 (whole numbers, or their text), once each, sorted (the map sorts them too). */
export function cleanSdgs(values: readonly unknown[] | undefined): number[] {
  const out = new Set<number>();
  for (const v of Array.isArray(values) ? values : []) {
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,2}$/.test(v.trim()) ? Number(v) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= 17) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** The topics (`knowsAbout`): text, one line, trimmed, once each, in the order given; at most 50 of 200 characters. */
export function cleanTopics(values: readonly unknown[] | undefined): string[] {
  const out: string[] = [];
  for (const v of Array.isArray(values) ? values : []) {
    if (typeof v !== "string") continue;
    // eslint-disable-next-line no-control-regex
    const text = Array.from(v.replace(/[\u0000-\u001f\u007f]/g, " ").split(/\s+/).filter(Boolean).join(" ")).slice(0, MAX_TOPIC).join("");
    if (text && !out.includes(text)) out.push(text);
  }
  return out.slice(0, MAX_LIST);
}

type Lists = Pick<Draft, "memberOf" | "sdgs" | "knowsAbout">;

/** The three lists a draft may hold (#73), cleaned; a list left empty is absent. */
export function draftLists(raw: { memberOf?: unknown; sdgs?: unknown; knowsAbout?: unknown }): Lists {
  const out: Lists = {};
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const memberOf = cleanMemberOf(list(raw.memberOf));
  if (memberOf.length) out.memberOf = memberOf;
  const sdgs = cleanSdgs(list(raw.sdgs));
  if (sdgs.length) out.sdgs = sdgs;
  const knowsAbout = cleanTopics(list(raw.knowsAbout));
  if (knowsAbout.length) out.knowsAbout = knowsAbout;
  return out;
}

/**
 * A draft kept in this browser, read back (main.ts): text fields only, as before, plus a network's areas (the
 * one list a draft holds, cleaned). A kind that isn't "network" is dropped: absent is a space.
 */
export function draftFromStore(raw: unknown): Draft {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v;
  // The lists (#73) and what an import did not carry over: cleaned here, never copied as they are (a string
  // where a list belongs would pass the copy above).
  for (const key of ["memberOf", "sdgs", "knowsAbout", "notCarried"]) delete out[key];
  Object.assign(out, draftLists(raw as Record<string, unknown>));
  const notCarried = (raw as { notCarried?: unknown }).notCarried;
  if (Array.isArray(notCarried)) {
    const kept = notCarried.filter((k): k is string => typeof k === "string" && !!k.trim()).map((k) => k.trim().slice(0, 200)).slice(0, 100);
    if (kept.length) out.notCarried = kept;
  }
  // A stored `areaServed` that is a string (damaged or hand-edited) must not pass the copy above:
  // cleanAreas maps over it, and a throw there would break tile A on every load (review of #67).
  delete out.areaServed;
  const areas = (raw as { areaServed?: unknown }).areaServed;
  // `{code, name}` entries, and the bare codes a #67 draft kept (named ""); anything else is dropped.
  if (Array.isArray(areas)) {
    const clean = cleanAreas(areas);
    if (clean.length) out.areaServed = clean;
  }
  if (out.kind !== "network") delete out.kind;
  return out as Draft;
}

/**
 * What a network's card cannot do without, checked and trimmed: a name, an area, a pin. The fidelity is the
 * draft's when the map reads it, else the first area's shape; the country is the one all areas share (or none).
 */
export function networkParts(draft: Draft) {
  const name = (draft.name ?? "").trim();
  const areas = cleanAreas(draft.areaServed);
  const lat = (draft.lat ?? "").trim();
  const lon = (draft.lon ?? "").trim();
  const missing: SpaceFileProblem[] = [];
  if (!name) missing.push("name");
  if (!areas.length) missing.push("area");
  if (!DECIMAL.test(lat) || !DECIMAL.test(lon)) missing.push("pin");
  if (missing.length) throw new SpaceFileError(missing);
  const fidelity = cleanFidelity(draft.fidelity) ?? areaFidelity(areas[0].code);
  return { name, areas, country: areasCountry(areas), lat, lon, fidelity };
}

/** What a card cannot do without, checked and trimmed; throws `SpaceFileError` naming what is missing. */
export function requiredParts(draft: Draft) {
  const name = (draft.name ?? "").trim();
  const town = (draft.city ?? "").trim();
  const country = (draft.country ?? "").trim().toUpperCase();
  const lat = (draft.lat ?? "").trim();
  const lon = (draft.lon ?? "").trim();
  const missing: SpaceFileProblem[] = [];
  if (!name) missing.push("name");
  if (!town) missing.push("town");
  if (!/^[A-Z]{2}$/.test(country)) missing.push("country");
  if (!DECIMAL.test(lat) || !DECIMAL.test(lon)) missing.push("pin");
  if (missing.length) throw new SpaceFileError(missing);
  return { name, town, country, lat, lon };
}

export function spaceFile(draft: Draft): SpaceFile {
  const network = isNetwork(draft);
  // A network's required parts, or a space's: each throws `SpaceFileError` naming what is missing.
  const parts = network ? networkParts(draft) : null;
  const space = parts ? null : requiredParts(draft);
  const { name, lat, lon } = parts ?? space!;
  const dropped: SpaceFile["dropped"] = [];
  const lines: string[] = [];
  const add = (predicate: string, object: string) => lines.push(`  ${predicate} ${object}`);

  add("schema:name", literal(name));
  const description = (draft.description ?? "").trim();
  if (description) add("schema:description", literal(description));

  if (parts) {
    // A network: no address, one node per area served, its code and its name (an unknown name is left out).
    for (const area of parts.areas) {
      const named = area.name ? ` ; schema:name ${literal(area.name)}` : "";
      add("schema:areaServed", `[ a schema:AdministrativeArea ; schema:identifier ${literal(area.code)}${named} ]`);
    }
  } else {
    const { town, country } = space!;
    const address = [`a schema:PostalAddress`];
    const street = (draft.street ?? "").trim();
    if (street) address.push(`schema:streetAddress ${literal(street)}`);
    const postcode = (draft.postcode ?? "").trim();
    if (postcode) address.push(`schema:postalCode ${literal(postcode)}`);
    address.push(`schema:addressLocality ${literal(town)}`, `schema:addressCountry ${literal(country)}`);
    add("schema:address", `[ ${address.join(" ;\n    ")} ]`);
  }

  add("schema:geo", `[ a schema:GeoCoordinates ;\n    schema:latitude ${lat} ; schema:longitude ${lon} ]`);
  if (parts) add("mom:geolocationFidelity", literal(parts.fidelity));

  const email = (draft.email ?? "").trim();
  if (email) add("schema:email", literal(email));
  // Tile C's (14.6): tile A doesn't ask for them, but a file read back from the pod may hold them.
  const hours = (draft.hours ?? "").trim();
  if (hours) add("schema:openingHours", literal(hours));

  if ((draft.matrix ?? "").trim()) {
    const link = matrixLink(draft.matrix);
    if (link) add("schema:contactPoint", `[ a schema:ContactPoint ;\n    schema:contactType "Matrix" ;\n    schema:url ${link} ]`);
    else dropped.push("matrix");
  }
  for (const key of ["website", "logo"] as const) {
    if (!(draft[key] ?? "").trim()) continue;
    const value = iri(draft[key]);
    if (value) add(key === "website" ? "schema:url" : "schema:logo", value);
    else dropped.push(key);
  }
  // What an import brought (#73): the networks it names, its goals, its topics. Cleaned, so only what the map reads.
  const lists = draftLists(draft);
  if (lists.memberOf) add("mom:memberOf", lists.memberOf.map((m) => `<${m}>`).join(", "));
  if (lists.sdgs) add("mom:sdgs", lists.sdgs.join(", "));
  if (lists.knowsAbout) add("schema:knowsAbout", lists.knowsAbout.map(literal).join(", "));

  const turtle = [
    `@prefix schema: <${SCHEMA}> .`,
    `@prefix mom: <${MOM}> .`,
    "",
    network ? `<#space> a mom:Network, schema:Organization ;` : `<#space> a mom:Space, schema:Place ;`,
    lines.join(" ;\n") + " .",
    "",
  ].join("\n");
  return { turtle, dropped };
}

/**
 * The statements of a Turtle document with blank nodes named by what they hold,
 * as sorted lines: two files that say the same thing give the same list, whatever
 * their blank-node labels, prefixes or order. Used to tell "already written" from
 * "someone else's file" (lib/publish.ts) and to hold the writer to the map's
 * fixture. One level of blank nodes is enough: the file has no deeper ones.
 */
export function statements(turtle: string, base = "https://pod.example/space.ttl"): string[] {
  const quads: Quad[] = new Parser({ baseIRI: base }).parse(turtle);
  const text = (t: Term) =>
    t.termType === "Literal" ? `${JSON.stringify(t.value)}^^${t.datatype.value}` : t.termType === "BlankNode" ? "_" : `<${t.value}>`;
  const signature = new Map<string, string>();
  for (const q of quads) {
    if (q.subject.termType !== "BlankNode") continue;
    const list = signature.get(q.subject.value) ?? "";
    signature.set(q.subject.value, list + `${q.predicate.value}=${text(q.object)};`);
  }
  const sig = (t: Term) => (t.termType === "BlankNode" ? `_[${[...(signature.get(t.value) ?? "").split(";")].sort().join(";")}]` : text(t));
  return quads.map((q) => `${sig(q.subject)} ${q.predicate.value} ${sig(q.object)}`).sort();
}

/** True when two Turtle documents say exactly the same statements. */
export function sameStatements(a: string, b: string): boolean {
  try {
    return JSON.stringify(statements(a)) === JSON.stringify(statements(b));
  } catch {
    return false;
  }
}

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const MOM_NETWORK = MOM + "Network";
/** The types a space file's node may have: a space, or a network (2026-11-19). */
export const SPACE_TYPES: readonly string[] = [MOM + "Space", MOM_NETWORK];

/**
 * The other way: what a space file in the pod says, as the draft tile A shows
 * (#11). The pod is the source: signed in, the form and the card are filled from
 * here. Reads what `spaceFile` writes, and any file that says the same with other
 * prefixes, order or blank-node labels. null when the document holds no
 * `mom:Space` and no `mom:Network`. A value the form can't hold (a non-decimal
 * coordinate, an area whose identifier isn't an ISO code, a fidelity the map doesn't read) is
 * left out, never guessed. A network's country is the one its areas share.
 */
export function draftFromTurtle(turtle: string, base: string): Draft | null {
  const quads: Quad[] = new Parser({ baseIRI: base }).parse(turtle);
  const typed = quads.filter((q) => q.predicate.value === RDF_TYPE && SPACE_TYPES.includes(q.object.value)).map((q) => q.subject);
  if (!typed.length) return null;
  // The file's own `<#space>` first; otherwise the first space (or network) it names.
  const own = `${base.split("#")[0]}#space`;
  const subject = typed.find((s) => s.value === own) ?? typed[0];
  const network = quads.some((q) => q.subject.equals(subject) && q.predicate.value === RDF_TYPE && q.object.value === MOM_NETWORK);
  const objects = (s: Term, p: string) =>
    quads.filter((q) => q.subject.equals(s) && q.predicate.value === SCHEMA + p).map((q) => q.object);
  const one = (s: Term | undefined, p: string): string | undefined => (s ? objects(s, p)[0]?.value : undefined);

  const draft: Draft = network ? { kind: "network" } : {};
  const set = (key: keyof Draft, value: string | undefined) => {
    const text = value?.trim();
    if (text) (draft as Record<string, string>)[key] = text;
  };
  set("name", one(subject, "name"));
  if (network) {
    // A node (identifier and name), or the bare code #67 wrote (no name).
    const areas = cleanAreas(
      objects(subject, "areaServed").map((o) =>
        o.termType === "Literal" ? o.value : { code: one(o, "identifier") ?? "", name: one(o, "name") ?? "" }
      )
    );
    if (areas.length) draft.areaServed = areas;
    set("country", areasCountry(areas) ?? undefined);
    const fidelity = quads.find((q) => q.subject.equals(subject) && q.predicate.value === MOM + "geolocationFidelity")?.object.value;
    set("fidelity", cleanFidelity(fidelity) ?? undefined);
  }
  set("description", one(subject, "description"));
  // A network has no address: a stray one is not read, so the country stays the one its areas share.
  const address = network ? undefined : objects(subject, "address")[0];
  if (address) {
    set("street", one(address, "streetAddress"));
    set("postcode", one(address, "postalCode"));
    set("city", one(address, "addressLocality"));
    set("country", one(address, "addressCountry")?.toUpperCase());
  }
  const geo = objects(subject, "geo")[0];
  const lat = one(geo, "latitude");
  const lon = one(geo, "longitude");
  if (lat && lon && DECIMAL.test(lat.trim()) && DECIMAL.test(lon.trim())) {
    set("lat", lat);
    set("lon", lon);
  }
  set("email", one(subject, "email"));
  set("hours", one(subject, "openingHours"));
  for (const point of objects(subject, "contactPoint")) {
    if (one(point, "contactType") !== "Matrix") continue;
    const link = one(point, "url") ?? "";
    // matrix.to/#/<room> back to the room as typed; any other link stays a link.
    const room = /^https:\/\/matrix\.to\/#\/(.+)$/.exec(link)?.[1];
    set("matrix", room ? decodeURIComponent(room) : link);
  }
  set("website", one(subject, "url"));
  set("logo", one(subject, "logo"));
  // The lists (#73): a network by IRI (or the bare slug a hand-written file may hold), goals, topics.
  const momOf = (p: string) => quads.filter((q) => q.subject.equals(subject) && q.predicate.value === MOM + p).map((q) => q.object);
  Object.assign(
    draft,
    draftLists({
      memberOf: momOf("memberOf").map((o) => o.value),
      sdgs: momOf("sdgs").filter((o) => o.termType === "Literal").map((o) => o.value),
      knowsAbout: objects(subject, "knowsAbout").filter((o) => o.termType === "Literal").map((o) => o.value),
    })
  );
  return draft;
}
