/**
 * The hand-off across the sign-in redirect (Story 14.3 AC6): the pod was just
 * created in this tab, the provider's page signs the person in, and home, on
 * return, says the pod is ready and nothing is written in it yet.
 *
 * A marker in sessionStorage: it survives a same-tab redirect and dies with the
 * tab. It holds the new WebID and pod address, nothing else: never the email,
 * never the passphrase. Read once, then deleted; ignored unless its WebID is the
 * one that signed in, so it can never speak for someone else's session.
 *
 * Not progress: what is done is still read from the pod (tiles/done.ts). This
 * only chooses what the step panel says on the first draw after the return.
 * Storage that throws (private mode, blocked) costs the message, never the page.
 */
const KEY = "mom-home:pod-made";

export interface PodMade {
  webId: string;
  pod: string;
}

export function markPodMade(made: PodMade, store: Storage | undefined = globalThis.sessionStorage): void {
  try {
    store?.setItem(KEY, JSON.stringify({ webId: made.webId, pod: made.pod }));
  } catch {
    /* no storage: the return shows the ordinary workbench */
  }
}

export function takePodMade(webId: string, store: Storage | undefined = globalThis.sessionStorage): PodMade | null {
  let raw: string | null = null;
  try {
    raw = store?.getItem(KEY) ?? null;
    store?.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PodMade>;
    return typeof value.pod === "string" && value.webId === webId ? { webId, pod: value.pod } : null;
  } catch {
    return null;
  }
}
