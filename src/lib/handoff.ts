/**
 * The hand-off across the sign-in redirect (Story 14.3 AC6): the pod was just
 * created in this tab, the provider's page signs the person in, and home, on
 * return, says the pod is ready and nothing is written in it yet. The same
 * marker is how a signed-out page learns that this tab already made a pod, so
 * it offers to sign in to it instead of a form that would make a SECOND
 * account (CSS 7.2 cannot delete one).
 *
 * A marker in sessionStorage: it survives a same-tab redirect and dies with the
 * tab. It holds the new WebID, the pod address and the time, nothing else:
 * never the email, never the passphrase. It expires after 15 minutes; it is
 * read once, and only by the WebID it was written for, so another person's
 * sign-in can neither see it nor use it up.
 *
 * Not progress: what is done is still read from the pod (tiles/done.ts). This
 * only chooses what the step panel says. Storage that throws (private mode,
 * blocked site data), even on first access, costs the message, never the page
 * and never the sign-in that follows creating the pod.
 */
const KEY = "mom-home:pod-made";
/** Long enough for a slow provider page and a consent click; short enough that an abandoned one is forgotten. */
export const MARKER_MINUTES = 15;

export interface PodMade {
  webId: string;
  pod: string;
}

/** `sessionStorage` itself can throw on access, so it is reached here, inside a try. */
function storage(given?: Storage): Storage | undefined {
  if (given) return given;
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

export function markPodMade(made: PodMade, store?: Storage, now = Date.now()): void {
  try {
    storage(store)?.setItem(KEY, JSON.stringify({ webId: made.webId, pod: made.pod, at: now }));
  } catch {
    /* no storage: the return shows the ordinary workbench */
  }
}

/** The marker as stored, or null: absent, damaged, expired (and then removed), or not an https pod address. */
function read(st: Storage, now: number): (PodMade & { at: number }) | null {
  const raw = st.getItem(KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PodMade & { at: number }>;
    const fresh = typeof v.at === "number" && now - v.at < MARKER_MINUTES * 60_000 && now >= v.at;
    if (typeof v.webId === "string" && typeof v.pod === "string" && /^https:\/\//.test(v.pod) && fresh) {
      return { webId: v.webId, pod: v.pod, at: v.at! };
    }
  } catch {
    /* damaged */
  }
  st.removeItem(KEY);
  return null;
}

/** Signed in as `webId`: the marker if it is theirs (and then spent), else null and the marker stays. */
export function takePodMade(webId: string, store?: Storage, now = Date.now()): PodMade | null {
  try {
    const st = storage(store);
    const marker = st && read(st, now);
    if (!st || !marker || marker.webId !== webId) return null;
    st.removeItem(KEY);
    return { webId: marker.webId, pod: marker.pod };
  } catch {
    return null;
  }
}

/** Signed out: has this tab made a pod it did not sign in to yet? Not spent by looking. */
export function peekPodMade(store?: Storage, now = Date.now()): PodMade | null {
  try {
    const st = storage(store);
    const marker = st && read(st, now);
    return marker ? { webId: marker.webId, pod: marker.pod } : null;
  } catch {
    return null;
  }
}

export function clearPodMade(store?: Storage): void {
  try {
    storage(store)?.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
