/**
 * Conditional (optimistic-concurrency) reads and writes for a single document.
 *
 * Use this when something OTHER than this app can write the same resource — an
 * ingestion pipeline, a second tab, a collaborator. If the app is the only
 * writer, plain `solid-client` calls are simpler and enough.
 *
 * Two invariants, both learned the hard way. Break either and the failure is
 * silent data loss, not an error:
 *
 * 1. NEVER CACHE THE DOCUMENT ACROSS EDITS. Read it again for every write. A
 *    concurrent writer landing between two of the app's edits would otherwise
 *    be erased by a stale copy that never saw their change.
 *
 * 2. FAIL TO A KNOWN STATE. An interrupted write leaves the document exactly as
 *    it was, never half-applied — which is why the whole edit is expressed as
 *    one string transformation and sent as one PUT.
 *
 * Reads go through `authFetch` rather than solid-client's `getFile` because the
 * ETag has to come back with the body to be usable as the `If-Match` on the way
 * out. `cache: "no-store"` keeps the browser from serving a stale ETag.
 */
import { authFetch } from "./auth";

/** A request that failed, carrying the status and a machine-readable code. */
export interface ConditionalError extends Error {
  status?: number;
  code?: "conflict" | "not-found" | "read-failed" | "write-failed";
}

function fail(
  message: string,
  code: ConditionalError["code"],
  status?: number
): ConditionalError {
  const err = new Error(message) as ConditionalError;
  err.code = code;
  if (status !== undefined) err.status = status;
  return err;
}

export interface DocumentSnapshot {
  text: string;
  /** `null` when the server sent no ETag — writes then cannot be conditional. */
  etag: string | null;
}

/** Reads a document as text, keeping its ETag for a later conditional write. */
export async function readWithEtag(url: string): Promise<DocumentSnapshot> {
  const res = await authFetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw fail(`Could not read ${url} (${res.status}).`, "read-failed", res.status);
  }
  return { text: await res.text(), etag: res.headers.get("ETag") };
}

/**
 * Writes the document back, but only if it has not changed since `etag`.
 *
 * A `null` etag sends no `If-Match`, which is an unconditional overwrite — fine
 * for creating a document, wrong for updating a shared one.
 */
export async function writeIfMatch(
  url: string,
  text: string,
  etag: string | null,
  contentType = "text/turtle"
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": contentType };
  if (etag) headers["If-Match"] = etag;

  const res = await authFetch(url, { method: "PUT", headers, body: text });
  if (!res.ok) {
    throw fail(`Could not write ${url} (${res.status}).`, "write-failed", res.status);
  }
}

/**
 * Read → transform → write, retrying once if the document moved underneath us.
 *
 * `transform` receives the current text and returns the new text, or `null` to
 * abort (the thing being edited is no longer in the document). It must be pure
 * and repeatable: on a 412 it is called again against the newer text.
 *
 * Exactly one retry. A second 412 means something is actively contending for
 * this document, and retrying harder would just take longer to lose — that is
 * reported as a conflict for the app to surface.
 */
export async function updateDocument(
  url: string,
  transform: (current: string) => string | null,
  contentType = "text/turtle"
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text, etag } = await readWithEtag(url);

    const next = transform(text);
    if (next === null) {
      throw fail(`The target of this edit is no longer in ${url}.`, "not-found");
    }

    try {
      await writeIfMatch(url, next, etag, contentType);
      return;
    } catch (err) {
      const status = (err as ConditionalError).status;
      if (status !== 412) throw err;
      if (attempt === 1) {
        throw fail(
          `${url} keeps changing under us — the edit was not applied.`,
          "conflict",
          412
        );
      }
      // First 412: re-read and re-apply against whatever is there now.
    }
  }

  // Unreachable while the guard above is intact — and that is the point. If a
  // future edit lets the loop fall through, resolving here would report success
  // for a write that never happened, which is the exact failure this whole file
  // exists to prevent. Fail loudly instead.
  throw fail(
    `Gave up updating ${url} without writing.`,
    "conflict",
    412
  );
}
