/**
 * Tile A's form (Story 14.2): genjson's tier 0 as the gate (name, then where:
 * street optional, city required) and its tier 1 as optional fields. The
 * fields are the space file's (maps_of_making docs/reference/space-file.md);
 * hours, networks and SDGs belong to later tiles. Bernard says nothing here
 * (they enter at the card). Nothing typed is sent anywhere: it goes to the
 * draft the previews read.
 *
 * What the form says is the tree's (AC8): labels, hints, placeholders and the
 * example are `onb:field` nodes on `:describe`, buttons and messages its
 * `onb:ui*` lines (`describeWords`). What a field does (type, required, the
 * Enter key's label) is here.
 *
 * genjson's keyboard flow (AC4): the form reveals itself one beat at a time.
 * The name commits on Tab or Enter (or on leaving it) and opens where; the
 * city commits and opens the rest. A beat not reached yet is `inert`, so focus
 * can't land in it early. A draft that already has the values opens them all.
 */
import type { FieldWords, Tile } from "../tree/parse";
import { esc } from "./html";
import type { Draft } from "./previews";
import { pinLine, pinned } from "./where";

type Key = "name" | "street" | "city" | "description" | "email" | "matrix" | "website" | "logo";

interface Field {
  key: Key;
  type?: string;
  autocomplete?: string;
  required?: boolean;
  /** A phone's Enter key label (AC4): "next" until the beat's last field. */
  enter?: "next" | "done";
}

/** Name, then where: the bedrock. A city is enough; the street sharpens the pin. */
const BEDROCK: Field[] = [
  { key: "name", autocomplete: "organization", required: true },
  { key: "street", autocomplete: "address-line1" },
  { key: "city", autocomplete: "address-level2", required: true, enter: "done" },
];

/** The rest is the coordinator's to give, or not. */
const OPTIONAL: Field[] = [
  { key: "description" },
  { key: "email", type: "email", autocomplete: "email" },
  { key: "matrix" },
  { key: "website", type: "url", autocomplete: "url" },
  { key: "logo", type: "url", enter: "done" },
];

const FIELDS = [...BEDROCK, ...OPTIONAL];
/** What where.ts writes into the form: read back into the draft with the fields. */
const WHERE = ["country", "lat", "lon", "postcode", "place"] as const;
const REST = OPTIONAL.map((f) => f.key);

/** Every field the form draws, typed or worked out: each needs its words in the tree. */
export const FIELD_KEYS: readonly string[] = [...FIELDS.map((f) => f.key), "country", "lat", "lon"];
/** Every `onb:ui*` line tile A shows (form, card, where.ts): each needs to be in the tree. */
export const UI_KEYS = [
  "uiSeeMap", "uiOptional", "uiMore", "uiCta", "uiExample", "uiStartOver", "uiStartOverAsk", "uiClear",
  "uiKeepIt", "uiCleared", "uiFix", "uiChange", "uiNotOnPod", "uiPinWorking", "uiPinFound", "uiPinByHand",
  "uiStreetMissed", "uiNoResult", "uiUnavailable", "uiRate", "uiAddedScheme", "uiAddedRoom",
] as const;
export type UiKey = (typeof UI_KEYS)[number];

/** Tile A's words, read from the tree. */
export interface DescribeWords {
  field(key: string): FieldWords;
  /** A `{name}` in the line is filled from `vars`. */
  ui(name: UiKey, vars?: Record<string, string>): string;
}

/**
 * A word missing from the tree shows as nothing and says so in the console
 * (no copy of the words here to fall back on; the tests check the tree has
 * them all). A field missing its words shows its key, so the gap is seen.
 */
export function describeWords(tile: Pick<Tile, "ui" | "fields"> | undefined): DescribeWords {
  const warned = new Set<string>();
  const warn = (what: string) => {
    if (warned.has(what)) return;
    warned.add(what);
    console.warn(`onboarding.ttl: tile A has no ${what}.`);
  };
  return {
    field(key) {
      const words = tile?.fields[key];
      if (!words) warn(`onb:field "${key}"`);
      return words ?? { label: key, placeholder: null, hint: null, example: null };
    },
    ui(name, vars = {}) {
      const line = tile?.ui[name];
      if (line === undefined) {
        warn(`onb:${name}`);
        return "";
      }
      return line.replace(/\{(\w+)\}/g, (all, v: string) => vars[v] ?? all);
    },
  };
}

type Beat = "where" | "rest";

const beat = (name: Beat, open: boolean, body: string) =>
  `<div class="wb-beat${open ? " open" : ""}" data-beat="${name}"${open ? "" : " inert"}><div class="wb-beat-inner">${body}</div></div>`;

function field(f: Field, draft: Draft, w: DescribeWords): string {
  const id = `f-${f.key}`;
  const { label, placeholder, hint } = w.field(f.key);
  return `<label class="wb-field" for="${id}">${esc(label)}
        <input id="${id}" name="${f.key}" type="${f.type ?? "text"}" value="${esc(draft[f.key] ?? "")}"
          ${placeholder ? `placeholder="${esc(placeholder)}"` : ""}
          ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ""}
          ${f.required ? "required" : ""}
          enterkeyhint="${f.enter ?? "next"}"
          ${hint ? `aria-describedby="${id}-hint"` : ""} />
        ${hint ? `<span class="hint" id="${id}-hint">${esc(hint)}</span>` : ""}
      </label>`;
}

/**
 * Under street and city: the pin line, and the two fallbacks where.ts opens
 * when the geocoder can't answer for everything (a country, the coordinates).
 */
function whereOut(draft: Draft, w: DescribeWords): string {
  const line = pinLine(draft, w);
  // Resumed (AC7): a pin set by hand reopens the fallbacks it was typed in.
  const byHand = !!draft.lat && !draft.place;
  const needCountry = (!!draft.lat && !draft.country) || byHand;
  const country = w.field("country");
  const lat = w.field("lat");
  const lon = w.field("lon");
  const ph = (f: FieldWords) => (f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : "");
  return `
        <p class="wb-pin${line ? " ok" : ""}" id="f-pin" role="status">${line ? `<span class="wb-pin-line">${esc(line)}</span>` : ""}</p>
        <div data-manual="country"${needCountry ? "" : " hidden"}>
          <label class="wb-field" for="f-country">${esc(country.label)}
            <input id="f-country" name="country" type="text" maxlength="2" class="wb-country" value="${esc(draft.country ?? "")}"${ph(country)}
              autocomplete="country"${country.hint ? ` aria-describedby="f-country-hint"` : ""} />
            ${country.hint ? `<span class="hint" id="f-country-hint">${esc(country.hint)}</span>` : ""}
          </label>
        </div>
        <div class="wb-doors" data-manual="coords"${byHand ? "" : " hidden"}>
          <label class="wb-field" for="f-lat">${esc(lat.label)}<input id="f-lat" name="lat" type="number" step="any" min="-90" max="90" value="${esc(draft.lat ?? "")}"${ph(lat)} /></label>
          <label class="wb-field" for="f-lon">${esc(lon.label)}<input id="f-lon" name="lon" type="number" step="any" min="-180" max="180" value="${esc(draft.lon ?? "")}"${ph(lon)} /></label>
        </div>
        <input type="hidden" name="postcode" value="${esc(draft.postcode ?? "")}" />
        <input type="hidden" name="place" value="${esc(draft.place ?? "")}" />`;
}

/**
 * The key where.ts asks under, for a draft that already has its pin: a
 * resumed draft (AC7) doesn't ask the geocoder again for what it answered.
 * A country typed by hand is part of the ask; a derived one isn't (where.ts).
 */
function locatedKey(draft: Draft): string | null {
  if (!draft.lat || !draft.lon || !draft.place || !draft.city) return null;
  return `${draft.street ?? ""}|${draft.city}|`;
}

export function renderDescribeForm(draft: Draft, w: DescribeWords): string {
  const [name, street, city] = BEDROCK.map((f) => field(f, draft, w));
  const ready = !!(draft.name && draft.city && draft.lat && draft.lon && draft.country);
  const located = locatedKey(draft);
  const typed = FIELDS.some((f) => draft[f.key]);
  // Anything optional already typed keeps the fold open: nothing typed hides behind it.
  const more = OPTIONAL.some((f) => draft[f.key]);
  return `
    <form id="f-describe" class="wb-form${more ? " more-open" : ""}" novalidate${located ? ` data-located="${esc(located)}"` : ""}>
      ${name}
      ${beat("where", !!draft.name, `<div class="wb-doors">${street}${city}</div>${whereOut(draft, w)}`)}
      ${beat(
        "rest",
        !!draft.name && !!draft.city,
        // On a phone the optional fields fold behind one line (AC3); home.css shows the button there only.
        `<button type="button" class="inline-link wb-more" id="more" aria-expanded="${more}" aria-controls="f-optional">${esc(w.ui("uiMore"))}</button>
        <fieldset class="wb-optional" id="f-optional">
          <legend class="wf-label">${esc(w.ui("uiOptional"))}</legend>
          ${OPTIONAL.map((f) => field(f, draft, w)).join("")}
        </fieldset>`
      )}
      <div class="wb-out">
        <button type="submit" class="btn btn-primary wb-cta"${ready ? "" : " disabled"}>${esc(w.ui("uiCta"))}</button>
        <button type="button" class="inline-link" id="example"${typed ? " hidden" : ""}>${esc(w.ui("uiExample"))}</button>
        <button type="button" class="inline-link" id="start-over"${typed ? "" : " hidden"}>${esc(w.ui("uiStartOver"))}</button>
      </div>
      <div class="wb-confirm" id="start-over-confirm" role="group" aria-labelledby="start-over-q" hidden>
        <p id="start-over-q">${esc(w.ui("uiStartOverAsk"))}</p>
        <button type="button" class="btn" id="clear-yes">${esc(w.ui("uiClear"))}</button>
        <button type="button" class="inline-link" id="clear-no">${esc(w.ui("uiKeepIt"))}</button>
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

/** "Fill in an example": the tree's `onb:example`s, a space that doesn't exist. */
export function fillExample(form: HTMLFormElement, w: DescribeWords): void {
  for (const f of FIELDS) {
    const input = form.elements.namedItem(f.key) as HTMLInputElement | null;
    if (input) input.value = w.field(f.key).example ?? "";
  }
  reveal(form, "where");
  reveal(form, "rest");
  showMore(form, true);
  syncCta(form);
}

/** The phone's "Add more" fold (AC3). Above a phone's width the fields always show. */
export function showMore(form: HTMLFormElement, open: boolean): void {
  form.classList.toggle("more-open", open);
  form.querySelector("#more")?.setAttribute("aria-expanded", String(open));
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
  // Nothing typed: the example. Something typed: the way back to nothing (AC7, the draft is kept).
  const typed = FIELDS.some((f) => filled(form, f.key));
  const example = form.querySelector<HTMLElement>("#example");
  const over = form.querySelector<HTMLElement>("#start-over");
  if (example && over && example.hidden === !typed) {
    // Focus doesn't vanish with the button it was on.
    const hadFocus = document.activeElement === (typed ? example : over);
    example.hidden = typed;
    over.hidden = !typed;
    if (hadFocus) (typed ? over : example).focus();
  }
}

/** "Start over" asks first, in the page (no confirm(): genjson's, refused in some frames). */
export function askStartOver(form: HTMLFormElement, open: boolean): void {
  const box = form.querySelector<HTMLElement>("#start-over-confirm");
  if (!box) return;
  box.hidden = !open;
  form.querySelector<HTMLElement>(open ? "#clear-yes" : "#start-over")?.focus();
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
      // Folded on a phone, the description can't take focus: the fold's button does.
      if (document.activeElement !== input(form, "description")) form.querySelector<HTMLElement>("#more")?.focus();
    } else if (enter) event.preventDefault();
  } else if (enter && REST.includes(key)) {
    // An optional field: Enter goes to the next; on the last one it submits (the card).
    const next = REST[REST.indexOf(key) + 1];
    if (next) go(next);
  }
}

/**
 * genjson's visible normalisers (Dev Notes): leaving website or logo without
 * a scheme adds https://; leaving a Matrix room as name:server adds the #.
 * The field's hint says what was added and keeps saying it until the field is
 * edited again (a timer was gone before people read it, genjson found).
 */
export function normalizeUrl(value: string): string {
  const v = value.trim();
  if (!v || /^https?:\/\//i.test(v)) return v;
  // Another explicit scheme (data:, ftp:) is left alone.
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[^:]+:\d/.test(v)) return v;
  return `https://${v}`;
}

export function normalizeMatrix(value: string): string {
  const v = value.trim();
  // A link (https://matrix.to/#/...) or anything with a path is left as pasted.
  if (!v || /^[#+!@]/.test(v) || !v.includes(":") || v.includes("/")) return v;
  return `#${v}`;
}

const NORMALISE: Partial<Record<Key, { fn: (v: string) => string; said: UiKey }>> = {
  website: { fn: normalizeUrl, said: "uiAddedScheme" },
  logo: { fn: normalizeUrl, said: "uiAddedScheme" },
  matrix: { fn: normalizeMatrix, said: "uiAddedRoom" },
};

const hintOf = (form: HTMLFormElement, key: string) => form.querySelector<HTMLElement>(`#f-${key}-hint`);

/** On leaving a field: true when its value was changed (the draft needs saving). */
export function describeNormalise(form: HTMLFormElement, target: EventTarget | null, w: DescribeWords): boolean {
  if (!(target instanceof HTMLInputElement)) return false;
  const rule = NORMALISE[target.name as Key];
  if (!rule) return false;
  const next = rule.fn(target.value);
  if (next === target.value.trim()) return false;
  target.value = next;
  const hint = hintOf(form, target.name);
  if (hint) {
    hint.dataset.hint ??= hint.textContent ?? "";
    hint.textContent = w.ui(rule.said);
    hint.classList.add("is-changed");
  }
  return true;
}

/** Typing in a field again: its hint goes back to what it was. */
export function describeEdited(form: HTMLFormElement, target: EventTarget | null): void {
  if (!(target instanceof HTMLInputElement)) return;
  const hint = hintOf(form, target.name);
  if (!hint?.classList.contains("is-changed")) return;
  hint.textContent = hint.dataset.hint ?? "";
  hint.classList.remove("is-changed");
}
