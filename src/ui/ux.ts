/**
 * The UX preferences that are *values* rather than judgment.
 *
 * How preferences get set, in three tiers — this file is tier 1:
 *
 *   1. Constants here and in core.css, enforced by the components below and
 *      by `npm run audit`.
 *   2. Components in `./patterns.ts` — a principle embodied in something you
 *      import cannot be violated by accident, which is stronger than any doc.
 *   3. Judgment, in `docs/manual-tests.md` — copy tone, whether an action
 *      deserves a confirmation. No machine decides those.
 *
 * Changing a number here changes it everywhere, and the tests pin the
 * behaviour that depends on it. Change one deliberately; do not work around it
 * in a component.
 */

/**
 * Miller's law, applied: at most four things to hold at once in a single step.
 *
 * `renderConceptCard` throws above this rather than truncating. Dropping a
 * chunk silently would lose authored content; throwing surfaces the decision
 * the first time the screen is opened, which is when it can still be made
 * properly — split the step, or cut something.
 */
export const MAX_CHUNKS_PER_STEP = 4;

/**
 * How long an undo stays available.
 *
 * Long enough to notice the toast, read it and decide — and short enough that
 * the action feels finished. Below ~5s people who look away miss it entirely.
 */
export const UNDO_WINDOW_MS = 8000;

/**
 * Hick's law, applied: a choice offers at most this many options before it
 * stops being a choice and becomes a list to study.
 */
export const MAX_CHOICES = 4;

/**
 * Doherty threshold: below this, showing a loading indicator costs more than
 * it buys.
 *
 * A spinner that appears for 150ms and vanishes is a flicker — the eye reports
 * it as a glitch, not as progress. Most pod reads on a warm connection land
 * under this. `mountPending` waits this long before showing anything.
 */
export const PENDING_DELAY_MS = 400;

/**
 * How long an indeterminate wait stays silent before it starts explaining
 * itself.
 *
 * Past this, "still working" is no longer reassuring on its own: the honest
 * reading is that something is wrong with the provider, the network, or the
 * pod. A wait that never acknowledges being long is a dead end of the same
 * kind an error with no way forward is.
 */
export const PENDING_PATIENCE_MS = 10000;

/**
 * Every error state carries a way forward — an action, or a sentence saying
 * why there is none.
 *
 * The quality of the failure paths decides long-term trust more than the
 * quality of the success paths: a success is forgotten the moment it works,
 * a dead end is remembered. On a pod app failures are routine rather than
 * exceptional — expired tokens, a provider down, a pod that moved — and none
 * of them are the user's mistake.
 *
 * A boolean rather than a number because there is no threshold to tune: this
 * is either enforced or it is decoration. `renderError` throws when it is
 * violated, and the audit checks that the pairing still exists.
 */
export const ERRORS_MUST_OFFER_RECOVERY = true;

/**
 * Cells in a progress line (`renderProgress`): one per twelfth sent.
 *
 * Few enough to read at a glance like a terminal's status bar, enough that a
 * large upload visibly moves every few seconds. The number beside it carries
 * the precision; the cells only carry the shape.
 */
export const PROGRESS_CELLS = 12;
