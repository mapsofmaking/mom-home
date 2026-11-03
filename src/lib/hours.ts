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
function iri(value: string): string {
  return /[<>"{}|^`\\\s]/.test(value) ? bad("web address") : `<${value}>`;
}

const fail = (res: Response, what: string): never => {
  if (res.status === 401) throw new PublishError("expired", `${what}: ${res.status}`, res.status);
  // Signed in and refused: this account may not change the file. Signing in again won't help.
  if (res.status === 403) throw new PublishError("no-control", `${what}: ${res.status}`, res.status);
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
  // The same space the form was filled from (spacefile.ts draftFromTurtle): the file's own <#space>, else the first.
  const spaces = quads.filter((q) => q.predicate.value === RDF_TYPE && q.object.value === MOM_SPACE);
  const own = `${fileUrl}#space`;
  const found = (spaces.find((q) => q.subject.value === own) ?? spaces[0])?.subject;
  if (!found) throw new PublishError("unreadable", "The space file names no space.");
  if (found.termType !== "NamedNode") throw new PublishError("unreadable", "The space in the file has no address of its own: left alone.");
  const subject = found.value;
  return { subject, hours: quads.filter((q) => q.subject.value === subject && q.predicate.value === HOURS), etag: res.headers.get("ETag") };
}

/** The patch: the hours read go, the new ones come; nothing else in the file is touched. */
export function hoursPatch(subject: string, old: readonly Quad[], hours: string): string {
  const s = iri(subject);
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
  const plain = (q: Quad) => q.object.termType === "Literal" && !q.object.language && q.object.datatype.value === XSD_STRING;
  if (before.hours.length === 1 && was === hours && plain(before.hours[0])) return { status: "same", was, hours };
  // Without the read's ETag the write can't be conditional: an insert would land over a change it never saw.
  if (!before.etag) throw new PublishError("refused", "The pod sent no ETag, so the write can't check the file is unchanged.");

  const body = hoursPatch(before.subject, before.hours, hours);
  const res = await send(fetchImpl, fileUrl, { method: "PATCH", headers: { "Content-Type": "text/n3", "If-Match": before.etag }, body });
  if (!res.ok) fail(res, "Writing the hours");

  // The write is in: from here a failure is "not confirmed", never "nothing was written".
  let after: Read;
  try {
    after = await readHours(fileUrl, fetchImpl);
  } catch (err) {
    throw new PublishError("unconfirmed", `Written, but reading it back failed: ${(err as Error).message}`);
  }
  // Another writer may have changed the hours again since: what matters is that ours went in.
  if (!after.hours.some((q) => q.object.value === hours)) {
    throw new PublishError("unconfirmed", "Written, but the file read back doesn't say these hours: it may have changed since.");
  }
  return { status: "saved", was, hours };
}
