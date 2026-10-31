/**
 * Tile A's form (Story 14.2): genjson's tier 0 as the gate (name, then where:
 * street optional, city required) and its tier 1 as optional fields. The
 * fields are the space file's (maps_of_making docs/reference/space-file.md);
 * hours, networks and SDGs belong to later tiles. Labels and hints are the
 * app's own words, from genjson's `bernard_copy.yaml` field hints; Bernard
 * says nothing here (they enter at the card). Nothing typed is sent anywhere:
 * it goes to the draft the previews read.
 */
import { esc } from "./html";
import type { Draft } from "./previews";

type Key = "name" | "street" | "city" | "description" | "email" | "matrix" | "website" | "logo";

interface Field {
  key: Key;
  label: string;
  type?: string;
  placeholder?: string;
  hint?: string;
  autocomplete?: string;
  required?: boolean;
}

/** Name, then where: the bedrock. A city is enough; the street sharpens the pin. */
const BEDROCK: Field[] = [
  { key: "name", label: "Space name", placeholder: "The name your community knows", autocomplete: "organization", required: true },
  { key: "street", label: "Street address", placeholder: "e.g. Rue du Canal 12", hint: "Optional. Without it, the pin sits in the town's centre.", autocomplete: "address-line1" },
  { key: "city", label: "City", hint: "The town or municipality.", autocomplete: "address-level2", required: true },
];

/** The rest is the coordinator's to give, or not. */
const OPTIONAL: Field[] = [
  { key: "description", label: "Description", placeholder: "One or two sentences. What kind of space is this?" },
  { key: "email", label: "Contact email", type: "email", placeholder: "hello@example.org", hint: "Not a personal inbox. Somewhere the space can be reached.", autocomplete: "email" },
  { key: "matrix", label: "Matrix room", placeholder: "#yourspace:matrix.org", hint: "The space's room, not a personal account." },
  { key: "website", label: "Website", type: "url", placeholder: "example.org", autocomplete: "url" },
  { key: "logo", label: "Logo URL", type: "url", placeholder: "example.org/logo.png", hint: "Transparent PNG works best." },
];

const FIELDS = [...BEDROCK, ...OPTIONAL];

/** "Fill in an example": a space that doesn't exist, so nothing typed is mistaken for real. */
export const EXAMPLE: Partial<Record<Key, string>> = {
  name: "Atelier du Canal",
  street: "Rue du Canal 12",
  city: "Anderlecht",
  description: "Open workshop for repairs and prototypes. Beginners welcome on Thursdays.",
  email: "contact@atelierducanal.example",
  matrix: "#atelierducanal:matrix.org",
  website: "https://atelierducanal.example",
};

function field(f: Field, draft: Draft): string {
  const id = `f-${f.key}`;
  const hint = f.hint ? `<span class="hint" id="${id}-hint">${esc(f.hint)}</span>` : "";
  return `<label class="wb-field" for="${id}">${esc(f.label)}
        <input id="${id}" name="${f.key}" type="${f.type ?? "text"}" value="${esc(draft[f.key] ?? "")}"
          ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ""}
          ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ""}
          ${f.required ? "required" : ""}
          ${f.hint ? `aria-describedby="${id}-hint"` : ""} />
        ${hint}
      </label>`;
}

export function renderDescribeForm(draft: Draft): string {
  const [name, street, city] = BEDROCK.map((f) => field(f, draft));
  return `
    <form id="f-describe" class="wb-form" novalidate>
      ${name}
      <div class="wb-doors">${street}${city}</div>
      <fieldset class="wb-optional">
        <legend class="wf-label">Optional · change it any time</legend>
        ${OPTIONAL.map((f) => field(f, draft)).join("")}
      </fieldset>
      <div class="wb-out">
        <button type="submit" class="btn btn-primary wb-cta">Show me my card</button>
        <button type="button" class="inline-link" id="example">Fill in an example</button>
      </div>
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
    if (input) input.value = EXAMPLE[f.key] ?? "";
  }
}
