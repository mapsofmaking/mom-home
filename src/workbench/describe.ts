/**
 * Tile A's form (Story 14.2): genjson's tier 0 as the gate (name, then where:
 * street optional, city required) and its tier 1 as optional fields. The
 * fields are the space file's (maps_of_making docs/reference/space-file.md);
 * hours, networks and SDGs belong to later tiles. Labels and hints are the
 * app's own words, from genjson's `bernard_copy.yaml` field hints; Bernard
 * says nothing here (they enter at the card). Nothing typed is sent anywhere:
 * it goes to the draft the previews read.
 *
 * genjson's keyboard flow (AC4): the form reveals itself one beat at a time.
 * The name commits on Tab or Enter (or on leaving it) and opens where; the
 * city commits and opens the rest. A beat not reached yet is `inert`, so focus
 * can't land in it early. A draft that already has the values opens them all.
 */
import { esc } from "./html";
import type { Draft } from "./previews";
import { pinLine, pinned } from "./where";

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
  { key: "name", label: "Space name", placeholder: "The name your community knows", hint: "Tab or Enter to move on.", autocomplete: "organization", required: true },
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
/** What where.ts writes into the form: read back into the draft with the fields. */
const WHERE = ["country", "lat", "lon", "postcode", "place"] as const;
const REST = OPTIONAL.map((f) => f.key);

type Beat = "where" | "rest";

const beat = (name: Beat, open: boolean, body: string) =>
  `<div class="wb-beat${open ? " open" : ""}" data-beat="${name}"${open ? "" : " inert"}><div class="wb-beat-inner">${body}</div></div>`;

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

/**
 * Under street and city: the pin line, and the two fallbacks where.ts opens
 * when the geocoder can't answer for everything (a country, the coordinates).
 */
function whereOut(draft: Draft): string {
  const line = pinLine(draft);
  const needCountry = !!draft.lat && !draft.country;
  return `
        <p class="wb-pin${line ? " ok" : ""}" id="f-pin" role="status">${line ? `<span class="wb-pin-line">${esc(line)}</span>` : ""}</p>
        <div data-manual="country"${needCountry ? "" : " hidden"}>
          <label class="wb-field" for="f-country">Country code
            <input id="f-country" name="country" type="text" maxlength="2" class="wb-country" value="${esc(draft.country ?? "")}"
              placeholder="e.g. BE" autocomplete="country" aria-describedby="f-country-hint" />
            <span class="hint" id="f-country-hint">Two letters, ISO. e.g. DE, FR, BE.</span>
          </label>
        </div>
        <div class="wb-doors" data-manual="coords" hidden>
          <label class="wb-field" for="f-lat">Latitude<input id="f-lat" name="lat" type="number" step="any" min="-90" max="90" value="${esc(draft.lat ?? "")}" placeholder="e.g. 50.84" /></label>
          <label class="wb-field" for="f-lon">Longitude<input id="f-lon" name="lon" type="number" step="any" min="-180" max="180" value="${esc(draft.lon ?? "")}" placeholder="e.g. 4.33" /></label>
        </div>
        <input type="hidden" name="postcode" value="${esc(draft.postcode ?? "")}" />
        <input type="hidden" name="place" value="${esc(draft.place ?? "")}" />`;
}

export function renderDescribeForm(draft: Draft): string {
  const [name, street, city] = BEDROCK.map((f) => field(f, draft));
  const ready = !!(draft.name && draft.city && draft.lat && draft.lon && draft.country);
  return `
    <form id="f-describe" class="wb-form" novalidate>
      ${name}
      ${beat("where", !!draft.name, `<div class="wb-doors">${street}${city}</div>${whereOut(draft)}`)}
      ${beat(
        "rest",
        !!draft.name && !!draft.city,
        `<fieldset class="wb-optional">
          <legend class="wf-label">Optional · change it any time</legend>
          ${OPTIONAL.map((f) => field(f, draft)).join("")}
        </fieldset>`
      )}
      <div class="wb-out">
        <button type="submit" class="btn btn-primary wb-cta"${ready ? "" : " disabled"}>Show me my card</button>
        <button type="button" class="inline-link" id="example">Fill in an example</button>
      </div>
    </form>`;
}

/** Reads the form back into the draft. Only what was typed: empty stays empty. */
export function readDescribeForm(form: HTMLFormElement, draft: Draft): void {
  const data = new FormData(form);
  for (const key of [...FIELDS.map((f) => f.key), ...WHERE]) {
    const value = String(data.get(key) ?? "").trim();
    if (value) draft[key] = value;
    else delete draft[key];
  }
}

export function fillExample(form: HTMLFormElement): void {
  for (const f of FIELDS) {
    const input = form.elements.namedItem(f.key) as HTMLInputElement | null;
    if (input) input.value = EXAMPLE[f.key] ?? "";
  }
  reveal(form, "where");
  reveal(form, "rest");
  syncCta(form);
}

const input = (form: HTMLFormElement, key: Key) => form.elements.namedItem(key) as HTMLInputElement | null;
const filled = (form: HTMLFormElement, key: Key) => !!input(form, key)?.value.trim();

/** Opens a beat: reachable by keyboard and screen readers from now on. */
export function reveal(form: HTMLFormElement, name: Beat): void {
  const el = form.querySelector<HTMLElement>(`[data-beat="${name}"]`);
  if (!el || el.classList.contains("open")) return;
  el.removeAttribute("inert");
  el.classList.add("open");
}

/** The card needs a name, a city and a pin; until then the button says so by being off. */
export function syncCta(form: HTMLFormElement): void {
  const cta = form.querySelector<HTMLButtonElement>("button[type=submit]");
  if (cta) cta.disabled = !(filled(form, "name") && filled(form, "city") && pinned(form));
}

/** The first required field still empty, to send focus to; null when the card can be drawn. */
export function missing(form: HTMLFormElement): HTMLInputElement | null {
  if (!filled(form, "name")) return input(form, "name");
  if (!filled(form, "city")) {
    reveal(form, "where"); // an inert field can't take focus
    return input(form, "city");
  }
  if (!pinned(form)) {
    // A fallback that is open names its own field; otherwise the city, whose leaving asks again.
    const open = (which: string) => !form.querySelector<HTMLElement>(`[data-manual="${which}"]`)?.hidden;
    const by = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
    if (open("country") && !/^[A-Z]{2}$/.test(by("country").value.trim())) return by("country");
    if (open("coords")) return by(by("lat").value.trim() ? "lon" : "lat");
    return input(form, "city");
  }
  return null;
}

/** Leaving a field commits it, without moving focus (a click elsewhere is the coordinator's choice). */
export function describeCommit(form: HTMLFormElement, target: EventTarget | null): void {
  if (!(target instanceof HTMLInputElement)) return;
  if (target.name === "name" && filled(form, "name")) reveal(form, "where");
  if (target.name === "city" && filled(form, "city") && filled(form, "name")) reveal(form, "rest");
}

/**
 * Tab or Enter moves on, the way genjson does: the name and the city commit
 * and open the next beat; Enter in the street goes to the city, and in an
 * optional field to the next one. Empty, a required field doesn't move on
 * (Tab still leaves it as usual). Shift+Tab is never touched.
 */
export function describeKeydown(form: HTMLFormElement, event: KeyboardEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const enter = event.key === "Enter";
  if (!enter && !(event.key === "Tab" && !event.shiftKey)) return;
  const go = (key: Key) => {
    event.preventDefault();
    input(form, key)?.focus();
  };
  const key = target.name as Key;
  if (key === "name") {
    if (filled(form, "name")) {
      reveal(form, "where");
      go("street");
    } else if (enter) event.preventDefault();
  } else if (key === "street") {
    if (enter) go("city");
  } else if (key === "city") {
    if (filled(form, "city") && filled(form, "name")) {
      reveal(form, "rest");
      go("description");
    } else if (enter) event.preventDefault();
  } else if (enter && REST.includes(key)) {
    // An optional field: Enter goes to the next; on the last one it submits (the card).
    const next = REST[REST.indexOf(key) + 1];
    if (next) go(next);
  }
}
