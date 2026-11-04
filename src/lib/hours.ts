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
  /** The file as the pod holds it after the save, read back (or before, when nothing was written). */
  text: string;
}

/** A term as N3 writes it: IRIs in angle brackets, literals with their language or datatype. */
export function n3Term(t: Term): string {
  if (t.termType === "NamedNode") return iri(t.value);
  if (t.termType !== "Literal") throw new PublishError("unreadable", `The file's hours are a ${t.termType}, not a line of text: left alone.`);
  const text = literal(t.value);
  if (t.language) return /^[A-Za-z]+(-[A-Za-z0-9]+)*$/.test(t.language) ? `${text}@${t.language}` : bad("language tag");
  return t.datatype.value === XSD_STRING ? text : `${text}^^${iri(t.datatype.value)}`;
}

const bad = (what: string): never => {
  throw new PublishError("unreadable", `The file holds a ${what} this page can't write back safely: left alone.`);
};

/** An IRI in angle brackets, refused when it holds a character that could end them (it would rewrite other statements). */
export function iri(value: string): string {
  return /[<>"{}|^`\\\s]/.test(value) ? bad("web address") : `<${value}>`;
}

export const fail = (res: Response, what: string): never => {
  if (res.status === 401) throw new PublishError("expired", `${what}: ${res.status}`, res.status);
  // Signed in and refused: this account may not change the file. Signing in again won't help.
  if (res.status === 403) throw new PublishError("no-control", `${what}: ${res.status}`, res.status);
  if (res.status === 404) throw new PublishError("gone", `${what}: the file is not there`, 404);
  if (res.status === 409 || res.status === 412) throw new PublishError("conflict", `${what}: the file changed meanwhile (${res.status})`, res.status);
  throw new PublishError("refused", `${what}: ${res.status}`, res.status);
};

/** The space file as read: its space, every statement, the read's ETag and text. */
export interface SpaceRead {
  subject: string;
  quads: Quad[];
  etag: string | null;
  text: string;
}

interface Read extends SpaceRead {
  /** The statements of `predicate` on the space, as read. */
  found: Quad[];
}

async function readStatement(fileUrl: string, predicate: string, fetchImpl: Fetch): Promise<Read> {
  const read = await readSpaceFile(fileUrl, fetchImpl);
  return { ...read, found: read.quads.filter((q) => q.subject.value === read.subject && q.predicate.value === predicate) };
}

/** Reads the space file: fresh, with its ETag. Throws a PublishError (expired, no-control, gone, refused, unreadable). */
export async function readSpaceFile(fileUrl: string, fetchImpl: Fetch): Promise<SpaceRead> {
  const res = await send(fetchImpl, fileUrl, { headers: { Accept: "text/turtle" } });
  if (!res.ok) fail(res, "Reading the space file");
  let quads: Quad[];
  const text = await res.text();
  try {
    quads = new Parser({ baseIRI: fileUrl }).parse(text);
  } catch (err) {
    throw new PublishError("unreadable", `The space file isn't Turtle any more: ${(err as Error).message}`);
  }
  // The same space the form was filled from (spacefile.ts draftFromTurtle): the file's own <#space>, else the first.
  const spaces = quads.filter((q) => q.predicate.value === RDF_TYPE && q.object.value === MOM_SPACE);
  const own = `${fileUrl}#space`;
  const found = (spaces.find((q) => q.subject.value === own) ?? spaces[0])?.subject;
  if (!found) throw new PublishError("unreadable", "The space file names no space.");
  if (found.termType !== "NamedNode") throw new PublishError("unreadable", "The space in the file has no address of its own: left alone.");
  return { subject: found.value, quads, etag: res.headers.get("ETag"), text };
}

/** The patch: the statements read go, the new one comes; nothing else in the file is touched. `object` is N3. */
export function statementPatch(subject: string, predicate: string, old: readonly Quad[], object: string): string {
  const s = iri(subject);
  const p = iri(predicate);
  const deletes = old.map((q) => `${s} ${p} ${n3Term(q.object)} .`).join(" ");
  return [
    "@prefix solid: <http://www.w3.org/ns/solid/terms#> .",
    "_:change a solid:InsertDeletePatch ;",
    ...(deletes ? [`  solid:deletes { ${deletes} } ;`] : []),
    `  solid:inserts { ${s} ${p} ${object} . } .`,
    "",
  ].join("\n");
}

/** The hours patch (S1): the hours read go, the new ones come. */
export const hoursPatch = (subject: string, old: readonly Quad[], hours: string) => statementPatch(subject, HOURS, old, literal(hours));

export interface StatementResult {
  /** saved: written and read back. same: the file already says exactly this; nothing was written. */
  status: "saved" | "same";
  /** What the file said before; null when it said nothing. */
  was: string | null;
  /** The file as the pod holds it after the save, read back (or before, when nothing was written). */
  text: string;
}

/** The new object of the statement: as N3, its value, and whether a statement read already says exactly it. */
export interface NewObject {
  n3: string;
  value: string;
  isSame: (q: Quad) => boolean;
}

/**
 * One statement of the space file changed (tile C: the hours, S1; the logo, S6): read with its ETag, one
 * N3 Patch with If-Match, read back. Throws a PublishError: expired, no-control, gone, conflict, unreachable,
 * refused, unreadable, unconfirmed.
 */
export async function changeStatement(fileUrl: string, predicate: string, object: NewObject, fetchImpl: Fetch): Promise<StatementResult> {
  const before = await readStatement(fileUrl, predicate, fetchImpl);
  const was = before.found[0]?.object.value ?? null;
  if (before.found.length === 1 && object.isSame(before.found[0])) return { status: "same", was, text: before.text };
  // Without the read's ETag the write can't be conditional: an insert would land over a change it never saw.
  if (!before.etag) throw new PublishError("refused", "The pod sent no ETag, so the write can't check the file is unchanged.");

  const body = statementPatch(before.subject, predicate, before.found, object.n3);
  const res = await send(fetchImpl, fileUrl, { method: "PATCH", headers: { "Content-Type": "text/n3", "If-Match": before.etag }, body });
  if (!res.ok) fail(res, "Writing the change");

  // The write is in: from here a failure is "not confirmed", never "nothing was written".
  let after: Read;
  try {
    after = await readStatement(fileUrl, predicate, fetchImpl);
  } catch (err) {
    throw new PublishError("unconfirmed", `Written, but reading it back failed: ${(err as Error).message}`);
  }
  // Another writer may have changed it again since: what matters is that ours went in.
  if (!after.found.some((q) => q.object.value === object.value)) {
    throw new PublishError("unconfirmed", "Written, but the file read back doesn't say it: it may have changed since.");
  }
  return { status: "saved", was, text: after.text };
}

/** The hours, changed in the file at `fileUrl`. Throws a PublishError: expired, gone, conflict, unreachable, refused, unreadable. */
export async function saveHours(fileUrl: string, typed: string, fetchImpl: Fetch = (u, i) => authFetch(u, i)): Promise<HoursResult> {
  const hours = typed.trim();
  if (!hours) throw new PublishError("incomplete", "No hours to write.");
  const plain = (q: Quad) => q.object.termType === "Literal" && !q.object.language && q.object.datatype.value === XSD_STRING;
  const r = await changeStatement(fileUrl, HOURS, { n3: literal(hours), value: hours, isSame: (q) => plain(q) && q.object.value === hours }, fetchImpl);
  return { ...r, hours };
}
