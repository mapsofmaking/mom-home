/**
 * Reads a literal that may or may not carry a language tag.
 *
 * The trap this closes: `getStringNoLocale` returns `null` for a
 * language-tagged literal. A document that is untagged today (which is most
 * hand-written and most machine-generated Turtle — tagging is easy to forget,
 * and nothing enforces it) reads fine with `getStringNoLocale` alone. The day
 * *something* starts tagging — a new writer, an import from a tool that
 * defaults to `@en`, an edit made in a language-aware client — every value
 * read through `getStringNoLocale` goes blank at once, with no error to point
 * at why. Read for both shapes from the start, before anything tags, not
 * after.
 *
 * `preferred` is the order to try tagged variants in — typically the app's
 * current UI language first, then a fallback chain. The untagged form is
 * tried right after the first preference: an app is far more likely to be
 * reading its own untagged writes than a genuinely second-choice language, and
 * an untagged hit beats reaching for a language nobody asked for.
 *
 * Returns `null`, same as `getStringNoLocale`, when nothing matches at all.
 */
import { getStringNoLocale, getStringWithLocale, type Thing } from "@inrupt/solid-client";

export function readLiteral(
  thing: Thing,
  predicate: string,
  preferred: string[] = []
): string | null {
  if (preferred.length > 0) {
    const first = getStringWithLocale(thing, predicate, preferred[0]);
    if (first !== null) return first;
  }

  const untagged = getStringNoLocale(thing, predicate);
  if (untagged !== null) return untagged;

  for (const lang of preferred.slice(1)) {
    const tagged = getStringWithLocale(thing, predicate, lang);
    if (tagged !== null) return tagged;
  }

  return null;
}
