/**
 * Local drafts for work that exists nowhere else yet.
 *
 * Between the moment a user finishes entering something and the moment the pod
 * accepts it, the browser holds the only copy. A failed write, an expired
 * session, or a closed tab loses it. A draft in `localStorage` costs almost
 * nothing and removes that whole class of loss.
 *
 * Scope this to work the user actually did — not to form state in general.
 * And remember a saved draft is invisible unless the app surfaces it: without
 * a "resume" affordance somewhere, this only moves the loss later.
 */

/** Wrapper stored under the key; `savedAt` drives expiry. */
interface Envelope<T> {
  savedAt: string;
  value: T;
}

export interface DraftStore<T> {
  /** Overwrites the draft for this id. Call on open and on every edit. */
  save(id: string, value: T): void;
  /** Returns the draft, or `null` if absent, expired, or unreadable. */
  load(id: string): T | null;
  /** Call after a successful write, or when the user discards. */
  clear(id: string): void;
}

/**
 * `keyPrefix` namespaces the app's drafts within the origin's storage — apps
 * sharing an origin would otherwise read each other's. `id` is whatever
 * identifies the thing being drafted, usually its container URL.
 *
 * Every access is wrapped: `localStorage` throws outright in some private
 * modes and when the quota is full, and losing a draft is much better than
 * crashing the screen the user is working in.
 */
export function makeDraftStore<T>(
  keyPrefix: string,
  maxAgeMs = 24 * 60 * 60 * 1000
): DraftStore<T> {
  const keyFor = (id: string) => `${keyPrefix}:${id}`;

  const clear = (id: string): void => {
    try {
      localStorage.removeItem(keyFor(id));
    } catch {
      // Nothing to do — failing to clean up is not worth surfacing.
    }
  };

  return {
    save(id, value) {
      try {
        const envelope: Envelope<T> = { savedAt: new Date().toISOString(), value };
        localStorage.setItem(keyFor(id), JSON.stringify(envelope));
      } catch {
        // Storage unavailable or full: proceed without a draft rather than block.
      }
    },

    load(id) {
      try {
        const raw = localStorage.getItem(keyFor(id));
        if (!raw) return null;
        const envelope = JSON.parse(raw) as Envelope<T>;
        if (Date.now() - new Date(envelope.savedAt).getTime() > maxAgeMs) {
          clear(id);
          return null;
        }
        return envelope.value;
      } catch {
        // Unparseable (an older shape, a truncated write): treat as no draft.
        return null;
      }
    },

    clear,
  };
}
