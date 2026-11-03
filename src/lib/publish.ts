/**
 * Putting the space on the map, from the signed-in coordinator's pod (Story 14.4).
 * S1 is the first step: the file. Each step reports its own outcome and its own
 * failure (AC5), asks first whether it is already done (a retry resumes, it never
 * redoes), and throws a `PublishError` with a code the page turns into a message.
 *
 * Plain requests through `authFetch`: the session holds the access, nothing is
 * kept here. A 401 or 403 is "your session ended", never "the file is missing".
 */
import { getAccess, isValidWebId, setAccess, setPublicAccess } from "./acl";
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
  | "not-public"
  /** Anyone, or anyone signed in, can already change the file: "read only" would be a lie. */
  | "rules-wider"
  /** 403 on the rules: this account can't change who reads the file. Signing in again won't help. */
  | "no-control"
  /** The rules changed meanwhile (412): pressing again reads them afresh. */
  | "conflict"
  /** The file is no longer there. */
  | "gone"
  /** The pod server uses other access rules than WAC (no `rel="acl"`). */
  | "no-wac"
  /** The map read the file and didn't take it (422). */
  | "map-refused"
  /** The map's register answered with an error. */
  | "map-down"
  /** The write went out, but reading it back failed: it may well be there (tile C, 14.6). */
  | "unconfirmed";

export class PublishError extends Error {
  readonly code: PublishCode;
  readonly status: number | null;
  readonly missing: SpaceFileProblem[];
  /** For "not-public": whether the rules were already public before this press (then pressing again won't help). */
  readonly rulesWere: "made-public" | "already-public" | null;
  constructor(
    code: PublishCode,
    message: string,
    status: number | null = null,
    missing: SpaceFileProblem[] = [],
    rulesWere: "made-public" | "already-public" | null = null
  ) {
    super(message);
    this.rulesWere = rulesWere;
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

export async function send(fetchImpl: Fetch, url: string, init: RequestInit): Promise<Response> {
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
  return readSpaceAt(spaceFileUrl(podRoot), fetchImpl);
}

/** The same, at an address the Type Index gave (#14). */
export async function readSpaceAt(fileUrl: string, fetchImpl: Fetch = (url, init) => authFetch(url, init)): Promise<SpaceRead | null> {
  const url = fileUrl.split("#")[0];
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

/** Who can read: the public modes and the signed-in modes, as acl.ts reads them. */
type Modes = readonly string[];
/** Anything beyond Read for the public or for everyone signed in: anyone could change the file. */
const wider = (pub: Modes, signedIn: Modes) => pub.some((m) => m !== "read") || signedIn.some((m) => m !== "read");

/** Races a phase against the step's time limit: a pod that hangs must not hold the panel and the tiles. */
async function inTime<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PublishError("unreachable", `${what}: no answer in ${TIMEOUT_MS / 1000} s.`)), TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * An error from acl.ts in this file's terms. `reading` is true while the rules are being read and parsed:
 * a failure without a status there is rules this app can't read (an .acl that isn't Turtle).
 */
function aclFailure(err: unknown, what: string, reading: boolean): PublishError {
  if (err instanceof PublishError) return err;
  const e = err as { status?: number; code?: string; message?: string };
  const message = e.message ?? String(err);
  if (e.status === 401) return new PublishError("expired", `${what}: the pod refused this session (401).`, 401);
  // 403 is not "sign in again": signing in again gives the same 403. The signer can't change who reads it.
  if (e.status === 403) return new PublishError("no-control", `${what}: this account can't change who reads the file (403).`, 403);
  if (e.status === 412 || e.code === "conflict") return new PublishError("conflict", `${what}: the rules changed meanwhile.`, 412);
  if (e.status === 404) return new PublishError("gone", `${what}: the file is no longer there (404).`, 404);
  if (typeof e.status === "number") return new PublishError("refused", `${what} (${e.status}).`, e.status);
  if (/advertises no access-control document/.test(message)) return new PublishError("no-wac", message);
  // acl.ts's rule-3 refusal, also raised on the re-read after a 412 (its wording, kept identical to the backoffice's).
  if (/does not understand/.test(message)) return new PublishError("rules-unknown", message);
  if (err instanceof TypeError) return new PublishError("unreachable", `${what}: ${message}`);
  if (reading) return new PublishError("rules-unknown", `${what}: the rules can't be read: ${message}`);
  return new PublishError("refused", `${what}: ${message}`);
}

export interface MakePublicOptions {
  /** What the anonymous read asks for (a logo is not Turtle). */
  accept?: string;
  /** That the anonymous answer is the resource itself, not a login or error page served as 200. */
  isTheResource?: (body: string, contentType: string | null) => boolean;
  anonFetch?: Fetch;
}

/**
 * Anyone can read one file, and only that (Story 14.4 AC3, #12). A helper that
 * takes the resource: 14.6 reuses it for a logo. The rules are the file's own
 * `.acl`, hand-written by acl.ts (kit ADR 003): the target is the file's own name,
 * the owner keeps Read, Write and Control, rules it doesn't understand are never
 * rewritten, WebIDs are validated.
 *
 * - Files only: a folder's `.acl` would open everything in it.
 * - Public Read and nothing more: a file anyone (or anyone signed in) can already
 *   change is refused, never reported as "read only".
 * - Asks first: already public, nothing is written (a retry resumes).
 * - A file with no rules of its own gets a copy of what its folder passes on
 *   (other agents, and the real owner if the signer isn't), plus public Read: a
 *   new `.acl` replaces inheritance, so nothing that reached the file is lost.
 * - The proof is a stranger's read: no credentials, exactly 200, no redirect, and
 *   the answer is the resource.
 */
export async function makePublic(resourceUrl: string, ownerWebId: string, options: MakePublicOptions = {}): Promise<PublicResult> {
  const { accept = "*/*", isTheResource = () => true, anonFetch = (url, init) => fetch(url, init) } = options;
  if (resourceUrl.endsWith("/")) throw new PublishError("refused", "Only a file is opened to anyone, never a folder.");
  if (!isValidWebId(ownerWebId)) throw new PublishError("refused", `Not a valid WebID: ${ownerWebId}`);
  const what = "Could not set who can read the file";

  let access: Awaited<ReturnType<typeof getAccess>>;
  try {
    access = await inTime(getAccess(resourceUrl, ownerWebId), what);
  } catch (err) {
    throw aclFailure(err, what, true);
  }

  let status: PublicResult["status"];
  if (wider(access.public, access.authenticated)) {
    throw new PublishError("rules-wider", "Anyone (or anyone signed in) can already change this file; left alone.");
  }
  if (access.public.includes("read")) {
    // Nothing to write, so nothing to rewrite: rules it doesn't understand elsewhere in the .acl don't matter here.
    status = "already-public";
  } else {
    if (access.unknown.length) throw new PublishError("rules-unknown", "The file's rules hold something this app does not understand; left alone.");
    try {
      if (access.inherited) {
        // What the folder passes on reaches the file today; the new .acl must keep it.
        const folder = await inTime(getAccess(new URL("./", resourceUrl).href, ownerWebId), what);
        if (folder.unknown.length) throw new PublishError("rules-unknown", "The folder's rules hold something this app does not understand; left alone.");
        if (wider(folder.inherits.public, folder.inherits.authenticated)) {
          throw new PublishError("rules-wider", "Anyone (or anyone signed in) can already change what is in this folder; left alone.");
        }
        await inTime(
          setAccess(resourceUrl, ownerWebId, { agents: folder.inherits.agents, authenticated: folder.inherits.authenticated, public: ["read"] }, null),
          what
        );
      } else {
        await inTime(setPublicAccess(resourceUrl, ownerWebId, ["read"]), what);
      }
      status = "made-public";
    } catch (err) {
      throw aclFailure(err, what, false);
    }
  }

  // The proof is what a stranger gets: no session, no cookie, no cache (send), and it must be the file.
  let anon: Response;
  try {
    anon = await send(anonFetch, resourceUrl, { headers: { Accept: accept }, credentials: "omit", redirect: "follow" });
  } catch (err) {
    // A fetch the browser blocks (CORS) looks like no answer; the signed-in steps just got answers.
    throw new PublishError("not-public", `An anonymous read of the file did not go through: ${(err as Error).message}`, null, [], status);
  }
  const body = anon.status === 200 && !anon.redirected ? await anon.text() : null;
  if (body === null || !isTheResource(body, anon.headers.get("content-type"))) {
    throw new PublishError("not-public", `An anonymous read of the file returned ${anon.status}${anon.redirected ? " after a redirect" : ""}.`, anon.status, [], status);
  }
  return { status };
}

/** The space file, opened to anyone: the proof must read back as a space. */
export async function makeSpacePublic(fileUrl: string, ownerWebId: string, anonFetch?: Fetch): Promise<PublicResult> {
  return makePublic(fileUrl, ownerWebId, {
    accept: "text/turtle",
    anonFetch,
    isTheResource: (body) => {
      try {
        return draftFromTurtle(body, fileUrl) !== null;
      } catch {
        return false;
      }
    },
  });
}

/** Whether a stranger can read the space file: no credentials, exactly 200, and it reads as a space (#14). */
export async function spaceIsPublic(fileUrl: string, anonFetch: Fetch = (url, init) => fetch(url, init)): Promise<boolean> {
  const res = await send(anonFetch, fileUrl, { headers: { Accept: "text/turtle" }, credentials: "omit" });
  if (res.status !== 200 || res.redirected) return false;
  try {
    return draftFromTurtle(await res.text(), fileUrl) !== null;
  } catch {
    return false;
  }
}
