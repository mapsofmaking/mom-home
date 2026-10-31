/**
 * Tile A's form, as drawn on the storyboard's Main frame: a feel of the tile
 * before Story 14.2 brings genjson's tiers 0–2 (and their copy, into the
 * tree) in its place. Nothing here is sent anywhere: what is typed goes to
 * the in-memory draft the previews read (AC4, signed out).
 */
import { esc } from "./html";
import type { Draft } from "./previews";

type Key = "name" | "address" | "description" | "email" | "hours";

const FIELDS: { key: Key; label: string; type?: string; placeholder?: string; hint?: string; autocomplete?: string }[] = [
  { key: "name", label: "Name", placeholder: "The name your community knows", autocomplete: "organization" },
  { key: "address", label: "Street Address", hint: "Street, number, postcode and town. The map puts your pin there.", autocomplete: "street-address" },
  { key: "description", label: "Description", placeholder: "What kind of space is this?" },
  { key: "email", label: "Contact email", type: "email", hint: "Not a personal inbox. Somewhere the space can be reached.", autocomplete: "email" },
  { key: "hours", label: "Opening hours", placeholder: "Tu-Sa 10:00-18:00", hint: "OSM opening_hours format." },
];

/** "Fill in an example": a space that doesn't exist, so nothing typed is mistaken for real. */
export const EXAMPLE: Required<Pick<Draft, Key>> = {
  name: "Atelier du Canal",
  address: "Rue du Canal 12, 1070 Anderlecht",
  description: "Open workshop for repairs and prototypes. Beginners welcome on Thursdays.",
  email: "contact@atelierducanal.example",
  hours: "Tu-Sa 10:00-18:00",
};

export function renderDescribeForm(draft: Draft): string {
  const fields = FIELDS.map((f) => {
    const id = `f-${f.key}`;
    const hint = f.hint ? `<span class="hint" id="${id}-hint">${esc(f.hint)}</span>` : "";
    return `<label class="wb-field" for="${id}">${esc(f.label)}
        <input id="${id}" name="${f.key}" type="${f.type ?? "text"}" value="${esc(draft[f.key] ?? "")}"
          ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ""}
          ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ""}
          ${f.hint ? `aria-describedby="${id}-hint"` : ""} />
        ${hint}
      </label>`;
  }).join("");
  return `
    <form id="f-describe" class="wb-form" novalidate>
      ${fields}
      <div class="wb-out">
        <button type="submit" class="btn btn-primary wb-cta">Show me my card</button>
        <button type="button" class="inline-link" id="example">Fill in an example</button>
      </div>
      <p class="wb-aside">Fields here are placeholders: the real ones come next. Nothing is sent anywhere.</p>
    </form>`;
}

/** Reads the form back into the draft. Only what was typed: empty stays empty. */
export function readDescribeForm(form: HTMLFormElement, draft: Draft): void {
  const data = new FormData(form);
  for (const f of FIELDS) {
    const value = String(data.get(f.key) ?? "").trim();
    if (value) draft[f.key] = value;
    else delete draft[f.key];
  }
}

export function fillExample(form: HTMLFormElement): void {
  for (const f of FIELDS) {
    const input = form.elements.namedItem(f.key) as HTMLInputElement | null;
    if (input) input.value = EXAMPLE[f.key];
  }
}
