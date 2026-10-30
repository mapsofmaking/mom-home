/**
 * Turtle reads for display, revalidated instead of downloaded again (ADR 007).
 *
 * Each document read keeps its ETag and body in memory. The next read of the
 * same address asks the server with `If-None-Match`; a 304 hands back the kept
 * body. The server is asked every time, so nothing shown is ever older than
 * the pod: this saves the download, not the round trip, and a read on someone
 * else's pod still reaches their access log.
 *
 * Only for showing things. A write reads its base through `conditional.ts`,
 * which never keeps a copy (its invariant 1). Memory only, never browser
 * storage: pod data must not outlive the session. `forgetReads()` at sign-out.
 */
import { authFetch } from "./auth";

interface Kept {
  etag: string;
  body: string;
  headers: [string, string][];
}

/** Enough for every document of a busy home screen; the oldest go first. */
const LIMIT = 500;
const kept = new Map<string, Kept>();

export async function readTurtle(url: string): Promise<Response> {
  const before = kept.get(url);
  const headers: Record<string, string> = { Accept: "text/turtle" };
  if (before) headers["If-None-Match"] = before.etag;
  // no-store: the browser neither answers from its own cache nor hides the 304.
  let res: Response;
  try {
    res = await authFetch(url, { headers, cache: "no-store" });
  } catch (err) {
    // A provider whose CORS refuses If-None-Match fails the request outright:
    // ask once more the plain way, so the cache can only save time.
    if (!before) throw err;
    kept.delete(url);
    return readTurtle(url);
  }

  if (res.status === 304 && before) {
    kept.delete(url); // re-inserted last: most recently used
    kept.set(url, before);
    return new Response(before.body, { status: 200, headers: before.headers });
  }
  kept.delete(url);
  const etag = res.headers.get("etag");
  if (!res.ok || !etag) return res;

  const body = await res.text();
  kept.set(url, { etag, body, headers: [...res.headers] });
  if (kept.size > LIMIT) kept.delete(kept.keys().next().value!);
  return new Response(body, { status: res.status, headers: res.headers });
}

export function forgetReads(): void {
  kept.clear();
}
