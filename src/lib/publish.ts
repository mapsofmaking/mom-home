/**
 * Putting the space on the map, from the signed-in coordinator's pod (Story 14.4).
 * S1 is the first step: the file. Each step reports its own outcome and its own
 * failure (AC5), asks first whether it is already done (a retry resumes, it never
 * redoes), and throws a `PublishError` with a code the page turns into a message.
 *
 * Plain requests through `authFetch`: the session holds the access, nothing is
 * kept here. A 401 or 403 is "your session ended", never "the file is missing".
 */
import { getAccess, setPublicAccess } from "./acl";
import { authFetch } from "./auth";
import { draftFromTurtle, sameStatements, spaceFile, SpaceFileError, type SpaceFile, type SpaceFileProblem } from "./spacefile";
import type { Draft } from "../workbench/previews";

export type PublishCode =
  /** The description lacks a name, a town and country or a pin: nothing is written. */
  | "incomplete"
  /** 401 or 403: the session ended or the pod does not belong to it. */
  | "expired"
  /** No answer, or too slow. */
  | "unreachable"
  /** The pod said no. */
  | "refused"
  /** The pod took the write but what it holds can't be read back as a space. */
  | "unreadable"
  /** The file's access rules hold something this app doesn't understand: left alone (ADR 003 rule 3). */
  | "rules-unknown"
  /** The rules were written, but an anonymous read still doesn't return the file. */
  | "not-public";

export class PublishError extends Error {
  readonly code: PublishCode;
  readonly status: number | null;
  readonly missing: SpaceFileProblem[];
  constructor(code: PublishCode, message: string, status: number | null = null, missing: SpaceFileProblem[] = []) {
    super(message);
    this.name = "PublishError";
    this.code = code;
    this.status = status;
    this.missing = missing;
  }
}

/** Per request: a pod that hangs must not hold the button for ever. */
export const TIMEOUT_MS = 20_000;

export interface FileResult {
  /** Where the file is. */
  url: string;
  /**
   * written: made now. already-there: it was there and says the same. kept-existing: something else is
   * there (the coordinator's own edit, or tile C's): it is left exactly as it is.
   */
  status: "written" | "already-there" | "kept-existing";
  dropped: SpaceFile["dropped"];
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const withRoot = (podRoot: string) => (podRoot.endsWith("/") ? podRoot : podRoot + "/");
export const spaceFileUrl = (podRoot: string) => new URL("space.ttl", withRoot(podRoot)).href;

async function send(fetchImpl: Fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new PublishError("unreachable", `The pod did not answer: ${(err as Error).message}`);
  }
}

function refuse(res: Response, what: string): PublishError {
  if (res.status === 401 || res.status === 403) {
    return new PublishError("expired", `${what}: the pod refused this session (${res.status}).`, res.status);
  }
  return new PublishError("refused", `${what} (${res.status}).`, res.status);
}

/**
 * Step 1: the file. Created with `If-None-Match: *`, so a file already there (the
 * coordinator's own edit, a second tab, tile C) is never overwritten: it is read,
 * and left alone whether it says the same or something else.
 */
export async function writeSpaceFile(
  podRoot: string,
  draft: Draft,
  fetchImpl: Fetch = (url, init) => authFetch(url, init)
): Promise<FileResult> {
  let file: SpaceFile;
  try {
    file = spaceFile(draft);
  } catch (err) {
    if (err instanceof SpaceFileError) throw new PublishError("incomplete", err.message, null, err.missing);
    throw err;
  }
  const url = spaceFileUrl(podRoot);

  const put = await send(fetchImpl, url, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle", "If-None-Match": "*" },
    body: file.turtle,
  });

  if (put.status === 412 || put.status === 409) {
    // Already there: read it, never replace it.
    const existing = await send(fetchImpl, url, { headers: { Accept: "text/turtle" } });
    if (!existing.ok) throw refuse(existing, "Could not read the file already in the pod");
    const text = await existing.text();
    return { url, status: sameStatements(text, file.turtle) ? "already-there" : "kept-existing", dropped: file.dropped };
  }
  if (!put.ok) throw refuse(put, "Could not write the file");

  // Read it back: the next steps depend on what the pod holds, not on what we sent.
  const back = await send(fetchImpl, url, { headers: { Accept: "text/turtle" } });
  if (!back.ok) throw refuse(back, "Could not read the file back");
  const text = await back.text();
  if (!sameStatements(text, file.turtle)) {
    throw new PublishError("unreadable", "The pod holds the file, but not as it was written.");
  }
  return { url, status: "written", dropped: file.dropped };
}

export interface SpaceRead {
  url: string;
  /** The space's IRI in the file (`…/space.ttl#space`). */
  space: string;
  draft: Draft;
}

/**
 * Reading the space back from the pod at sign-in (#11): the file at the root,
 * where step 1 writes it (the Type Index lookup comes with S4). null when there
 * is no file yet. A 401/403 is "your session ended" (`expired`), never "no file";
 * a file that is there but holds no space, or isn't Turtle, is `unreadable`: it
 * is shown as such and never overwritten (step 1 never replaces a file).
 */
export async function readSpaceFile(podRoot: string, fetchImpl: Fetch = (url, init) => authFetch(url, init)): Promise<SpaceRead | null> {
  const url = spaceFileUrl(podRoot);
  const res = await send(fetchImpl, url, { headers: { Accept: "text/turtle" } });
  if (res.status === 404) return null;
  if (!res.ok) throw refuse(res, "Could not read the space file");
  const text = await res.text();
  let draft: Draft | null;
  try {
    draft = draftFromTurtle(text, url);
  } catch (err) {
    throw new PublishError("unreadable", `The space file is not Turtle this app can read: ${(err as Error).message}`);
  }
  if (!draft) throw new PublishError("unreadable", "The file at space.ttl holds no space.");
  return { url, space: `${url}#space`, draft };
}

export interface PublicResult {
  /** made-public: public Read added now. already-public: it was there, nothing written. */
  status: "made-public" | "already-public";
}

/** An error from acl.ts (a ConditionalError or a plain Error) in this file's terms. */
function aclFailure(err: unknown, what: string): PublishError {
  if (err instanceof PublishError) return err;
  const status = (err as { status?: number }).status;
  if (status === 401 || status === 403) return new PublishError("expired", `${what}: the pod refused this session (${status}).`, status);
  if (typeof status === "number") return new PublishError("refused", `${what} (${status}).`, status);
  if (/does not understand/.test((err as Error).message ?? "")) return new PublishError("rules-unknown", (err as Error).message);
  // A fetch that never answered is a TypeError; anything else without a status is the pod refusing.
  if (err instanceof TypeError) return new PublishError("unreachable", `${what}: ${(err as Error).message}`);
  return new PublishError("refused", `${what}: ${(err as Error).message}`);
}

/**
 * Step 2: anyone can read the space file; the rest of the pod stays private
 * (Story 14.4 AC3, #12). The rules are the file's own `.acl`, hand-written by
 * acl.ts (kit ADR 003): the target is the file's own name, the owner keeps Read,
 * Write and Control, rules it doesn't understand are refused, never rewritten,
 * and other grants already there are kept. Asks first (a retry resumes): when
 * public Read is already granted, nothing is written. Then the proof: a read
 * without credentials must return the file.
 */
export async function makeSpacePublic(
  fileUrl: string,
  ownerWebId: string,
  anonFetch: Fetch = (url, init) => fetch(url, init)
): Promise<PublicResult> {
  let status: PublicResult["status"];
  try {
    const access = await getAccess(fileUrl, ownerWebId);
    if (access.unknown.length) {
      throw new PublishError("rules-unknown", "The file's access rules hold something this app does not understand; left alone.");
    }
    if (access.public.includes("read")) {
      status = "already-public";
    } else {
      await setPublicAccess(fileUrl, ownerWebId, [...access.public, "read"]);
      status = "made-public";
    }
  } catch (err) {
    throw aclFailure(err, "Could not set who can read the file");
  }
  // The proof is what a stranger gets: no session, no cookie.
  const anon = await send(anonFetch, fileUrl, { headers: { Accept: "text/turtle" }, credentials: "omit" });
  if (!anon.ok) throw new PublishError("not-public", `An anonymous read of the file returned ${anon.status}.`, anon.status);
  return { status };
}
