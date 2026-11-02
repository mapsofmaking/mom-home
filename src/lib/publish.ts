/**
 * Putting the space on the map, from the signed-in coordinator's pod (Story 14.4).
 * S1 is the first step: the file. Each step reports its own outcome and its own
 * failure (AC5), asks first whether it is already done (a retry resumes, it never
 * redoes), and throws a `PublishError` with a code the page turns into a message.
 *
 * Plain requests through `authFetch`: the session holds the access, nothing is
 * kept here. A 401 or 403 is "your session ended", never "the file is missing".
 */
import { authFetch } from "./auth";
import { sameStatements, spaceFile, SpaceFileError, type SpaceFile, type SpaceFileProblem } from "./spacefile";
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
  | "unreadable";

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
