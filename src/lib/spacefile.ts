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
 */
import { Parser, type Quad, type Term } from "n3";
import type { Draft } from "../workbench/previews";

const SCHEMA = "https://schema.org/";
const MOM = "https://mapsofmaking.org/ns/mom#";

export type SpaceFileProblem = "name" | "town" | "country" | "pin";

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
  return `<${url.href}>`;
}

/** `#room:server` as the link the map shows: matrix.to with the leading symbol encoded, colons kept. */
export function matrixLink(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return iri(text);
  if (!/^[#!@+][^\s:]+:[^\s]+$/.test(text)) return null;
  return iri(`https://matrix.to/#/${encodeURIComponent(text).replace(/%3A/gi, ":")}`);
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

export function spaceFile(draft: Draft): SpaceFile {
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

  const dropped: SpaceFile["dropped"] = [];
  const lines: string[] = [];
  const add = (predicate: string, object: string) => lines.push(`  ${predicate} ${object}`);

  add("schema:name", literal(name));
  const description = (draft.description ?? "").trim();
  if (description) add("schema:description", literal(description));

  const address = [`a schema:PostalAddress`];
  const street = (draft.street ?? "").trim();
  if (street) address.push(`schema:streetAddress ${literal(street)}`);
  const postcode = (draft.postcode ?? "").trim();
  if (postcode) address.push(`schema:postalCode ${literal(postcode)}`);
  address.push(`schema:addressLocality ${literal(town)}`, `schema:addressCountry ${literal(country)}`);
  add("schema:address", `[ ${address.join(" ;\n    ")} ]`);

  add("schema:geo", `[ a schema:GeoCoordinates ;\n    schema:latitude ${lat} ; schema:longitude ${lon} ]`);

  const email = (draft.email ?? "").trim();
  if (email) add("schema:email", literal(email));

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
    `<#space> a mom:Space, schema:Place ;`,
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
