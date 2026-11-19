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
 * a `schema:areaServed` of its own, and sits at the area's centre with `mom:geolocationFidelity` saying how
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

/** Areas as the map keeps them: upper case, valid codes only, once each, sorted, ten at most. */
export function cleanAreas(areas: readonly string[] | undefined): string[] {
  const codes = (areas ?? []).map((a) => a.trim().toUpperCase()).filter((a) => AREA_CODE.test(a));
  return [...new Set(codes)].sort().slice(0, MAX_AREAS);
}

/** The one country all the areas are in (`BE-VLG`, `BE-BRU` → `BE`); null when they span several, or none. */
export function areasCountry(areas: readonly string[]): string | null {
  const countries = new Set(areas.map((a) => a.slice(0, 2)));
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

/**
 * A draft kept in this browser, read back (main.ts): text fields only, as before, plus a network's areas (the
 * one list a draft holds, cleaned). A kind that isn't "network" is dropped: absent is a space.
 */
export function draftFromStore(raw: unknown): Draft {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v;
  const areas = (raw as { areaServed?: unknown }).areaServed;
  if (Array.isArray(areas)) {
    const clean = cleanAreas(areas.filter((a): a is string => typeof a === "string"));
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
  const fidelity = cleanFidelity(draft.fidelity) ?? areaFidelity(areas[0]);
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
    // A network: no address, one statement per area served.
    for (const area of parts.areas) add("schema:areaServed", literal(area));
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
 * coordinate, an area that isn't an ISO code, a fidelity the map doesn't read) is
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
    const areas = cleanAreas(objects(subject, "areaServed").filter((o) => o.termType === "Literal").map((o) => o.value));
    if (areas.length) draft.areaServed = areas;
    set("country", areasCountry(areas) ?? undefined);
    const fidelity = quads.find((q) => q.subject.equals(subject) && q.predicate.value === MOM + "geolocationFidelity")?.object.value;
    set("fidelity", cleanFidelity(fidelity) ?? undefined);
  }
  set("description", one(subject, "description"));
  const address = objects(subject, "address")[0];
  set("street", one(address, "streetAddress"));
  set("postcode", one(address, "postalCode"));
  set("city", one(address, "addressLocality"));
  set("country", one(address, "addressCountry")?.toUpperCase());
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
  return draft;
}
