/**
 * Tile C (Story 14.6 S1, #36): the opening hours, changed once, in the space's own file.
 *
 * The file has other writers (the backoffice, later Bernard), so it is never rewritten
 * whole from a draft: that would erase what they added. Only the hours statement
 * changes, as one N3 Patch (delete the hours read, insert the new ones), sent with the
 * ETag of that read (`If-Match`). A file changed since it was read is refused by the pod
 * (412), or the delete no longer matches (409): either way nothing is written, and the
 * coordinator is told to press again, which reads it afresh (lib/conditional.ts rule 1:
 * never cache the document across edits).
 *
 * Written, the file is read back: the hours must be there, once, as typed.
 */
import { Parser, type Quad, type Term } from "n3";
import { authFetch } from "./auth";
import { PublishError, send } from "./publish";
import { literal } from "./spacefile";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const SCHEMA = "https://schema.org/";
const HOURS = SCHEMA + "openingHours";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const MOM_SPACE = "https://mapsofmaking.org/ns/mom#Space";
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

export interface HoursResult {
  /** saved: written and read back. same: the file already says exactly this; nothing was written. */
  status: "saved" | "same";
  /** What the file said before; null when it had no hours. */
  was: string | null;
  hours: string;
}

/** A term as N3 writes it: IRIs in angle brackets, literals with their language or datatype. */
export function n3Term(t: Term): string {
  if (t.termType === "NamedNode") return `<${t.value}>`;
  if (t.termType !== "Literal") throw new Error(`Not a term a patch can name: ${t.termType}`);
  const text = literal(t.value);
  if (t.language) return `${text}@${t.language}`;
  return t.datatype.value === XSD_STRING ? text : `${text}^^<${t.datatype.value}>`;
}

const fail = (res: Response, what: string): never => {
  if (res.status === 401 || res.status === 403) throw new PublishError("expired", `${what}: ${res.status}`, res.status);
  if (res.status === 404) throw new PublishError("gone", `${what}: the file is not there`, 404);
  if (res.status === 409 || res.status === 412) throw new PublishError("conflict", `${what}: the file changed meanwhile (${res.status})`, res.status);
  throw new PublishError("refused", `${what}: ${res.status}`, res.status);
};

interface Read {
  subject: string;
  hours: Quad[];
  etag: string | null;
}

async function readHours(fileUrl: string, fetchImpl: Fetch): Promise<Read> {
  const res = await send(fetchImpl, fileUrl, { headers: { Accept: "text/turtle" } });
  if (!res.ok) fail(res, "Reading the space file");
  let quads: Quad[];
  try {
    quads = new Parser({ baseIRI: fileUrl }).parse(await res.text());
  } catch (err) {
    throw new PublishError("unreadable", `The space file isn't Turtle any more: ${(err as Error).message}`);
  }
  const spaces = quads.filter((q) => q.predicate.value === RDF_TYPE && q.object.value === MOM_SPACE && q.subject.termType === "NamedNode");
  const own = `${fileUrl}#space`;
  const subject = (spaces.find((q) => q.subject.value === own) ?? spaces[0])?.subject.value;
  if (!subject) throw new PublishError("unreadable", "The space file names no space.");
  return { subject, hours: quads.filter((q) => q.subject.value === subject && q.predicate.value === HOURS), etag: res.headers.get("ETag") };
}

/** The patch: the hours read go, the new ones come; nothing else in the file is touched. */
export function hoursPatch(subject: string, old: readonly Quad[], hours: string): string {
  const s = `<${subject}>`;
  const deletes = old.map((q) => `${s} <${HOURS}> ${n3Term(q.object)} .`).join(" ");
  return [
    "@prefix solid: <http://www.w3.org/ns/solid/terms#> .",
    "_:change a solid:InsertDeletePatch ;",
    ...(deletes ? [`  solid:deletes { ${deletes} } ;`] : []),
    `  solid:inserts { ${s} <${HOURS}> ${literal(hours)} . } .`,
    "",
  ].join("\n");
}

/** The hours, changed in the file at `fileUrl`. Throws a PublishError: expired, gone, conflict, unreachable, refused, unreadable. */
export async function saveHours(fileUrl: string, typed: string, fetchImpl: Fetch = (u, i) => authFetch(u, i)): Promise<HoursResult> {
  const hours = typed.trim();
  if (!hours) throw new PublishError("incomplete", "No hours to write.");
  const before = await readHours(fileUrl, fetchImpl);
  const was = before.hours[0]?.object.value ?? null;
  if (before.hours.length === 1 && was === hours) return { status: "same", was, hours };

  const headers: Record<string, string> = { "Content-Type": "text/n3" };
  if (before.etag) headers["If-Match"] = before.etag;
  const res = await send(fetchImpl, fileUrl, { method: "PATCH", headers, body: hoursPatch(before.subject, before.hours, hours) });
  if (!res.ok) fail(res, "Writing the hours");

  const after = await readHours(fileUrl, fetchImpl);
  if (after.hours.length !== 1 || after.hours[0].object.value !== hours) {
    throw new PublishError("unreadable", "The pod took the hours but the file doesn't say them back.");
  }
  return { status: "saved", was, hours };
}
