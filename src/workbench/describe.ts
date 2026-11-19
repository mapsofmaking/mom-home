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
 *
 * A space or a network (2026-11-19): the first choice, two buttons over a
 * hidden `kind` input; a space unless a network is picked, so a space's form
 * works exactly as before. A network has no street or city: its where is the
 * area it serves, searched by name anywhere ("Flanders", "Île-de-France") and
 * picked from what the geocoder offers (where.ts), so the area's code is always
 * one the map reads, never typed. Both where parts are drawn; the one not chosen
 * is hidden and inert, and is left out of the draft when the form is read back.
 */
import type { FieldWords, Tile } from "../tree/parse";
import { esc } from "./html";
import { tileUi } from "./tilewords";
import type { Draft, PreviewWords } from "./previews";
import { pinLine, pinned } from "./where";
import { areaLabel, areasCountry, cleanAreas, type Area } from "../lib/spacefile";

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
/** A space's where, left out of a network's draft. */
const SPACE_ONLY = ["street", "city", "postcode"] as const;

/** Every field the form draws, typed or worked out: each needs its words in the tree. */
export const FIELD_KEYS: readonly string[] = [...FIELDS.map((f) => f.key), "area", "country", "lat", "lon"];
/** Every `onb:ui*` line tile A shows (form, card, where.ts): each needs to be in the tree. */
export const UI_KEYS = [
  "uiSeeMap", "uiOptional", "uiMore", "uiCta", "uiExample", "uiStartOver", "uiStartOverAsk", "uiClear",
  "uiKeepIt", "uiCleared", "uiFix", "uiChange", "uiNotOnPod", "uiPinWorking", "uiPinFound", "uiPinByHand",
  "uiStreetMissed", "uiNoResult", "uiUnavailable", "uiRate", "uiAddedScheme", "uiAddedRoom",
  "uiKind", "uiKindSpace", "uiKindNetwork", "uiNameNetwork", "uiAreaFound",
  "uiPinArea", "uiNoResultArea", "uiUnavailableArea", "uiRateArea", "uiYourNetwork", "uiServes", "uiHoursFact",
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
  const ui = tileUi<UiKey>(tile, "tile A");
  return {
    field(key) {
      const words = tile?.fields[key];
      if (!words && !warned.has(key)) {
        warned.add(key);
        console.warn(`onboarding.ttl: tile A has no onb:field "${key}".`);
      }
      return words ?? { label: key, placeholder: null, hint: null, example: null };
    },
    ui,
  };
}

/** The areas, named as the geocoder named them and joined ("Flanders, Brussels"); an unnamed one by its code. */
export const areaNames = (areas: readonly Area[] | undefined) => cleanAreas(areas).map(areaLabel).join(", ");

/** The words a network's preview takes from tile A (previews.ts): "Your network", "Serves Flanders". */
export function previewWords(w: Pick<DescribeWords, "ui">): PreviewWords {
  return {
    yourNetwork: w.ui("uiYourNetwork"),
    hoursFact: w.ui("uiHoursFact"),
    areas: (d) => areaNames(d.areaServed),
    serves: (d) => {
      const areas = areaNames(d.areaServed);
      return areas ? w.ui("uiServes", { area: areas }) : "";
    },
  };
}

type Kind = "space" | "network";

type Beat = "where" | "rest";

const beat = (name: Beat, open: boolean, body: string) =>
  `<div class="wb-beat${open ? " open" : ""}" data-beat="${name}"${open ? "" : " inert"}><div class="wb-beat-inner">${body}</div></div>`;

function field(f: Field, draft: Draft, w: DescribeWords): string {
  const id = `f-${f.key}`;
  const { label, placeholder, hint } = w.field(f.key);
  // The name's label says what is named; both are on the label, so picking the kind swaps it in place.
  const named =
    f.key === "name"
      ? ` data-label-space="${esc(label)}" data-label-network="${esc(w.ui("uiNameNetwork"))}"><span class="wb-field-name">${esc(draft.kind === "network" ? w.ui("uiNameNetwork") : label)}</span>`
      : `>${esc(label)}`;
  return `<label class="wb-field" for="${id}"${named}
        <input id="${id}" name="${f.key}" type="${f.type ?? "text"}" value="${esc(draft[f.key] ?? "")}"
          ${placeholder ? `placeholder="${esc(placeholder)}"` : ""}
          ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ""}
          ${f.required ? "required" : ""}
          enterkeyhint="${f.enter ?? "next"}"
          ${hint ? `aria-describedby="${id}-hint"` : ""} />
        ${hint ? `<span class="hint" id="${id}-hint">${esc(hint)}</span>` : ""}
      </label>`;
}

/** The first choice: a space or a network. Two buttons over a hidden input, so the form's fields stay its fields. */
function kindChoice(kind: Kind, w: DescribeWords): string {
  const option = (k: Kind, words: UiKey) =>
    `<button type="button" class="btn wb-kind-option" data-kind="${k}" aria-pressed="${kind === k}">${esc(w.ui(words))}</button>`;
  return `
      <div class="wb-kind" role="group" aria-labelledby="f-kind-q">
        <p class="wf-label" id="f-kind-q">${esc(w.ui("uiKind"))}</p>
        <div class="wb-kind-options">${option("space", "uiKindSpace")}${option("network", "uiKindNetwork")}</div>
        <input type="hidden" name="kind" value="${kind}" />
      </div>`;
}

/**
 * A network's where: one box to search the area by name, the areas offered under it (where.ts fills the list),
 * and the pick in two hidden inputs. A draft with an area and its pin opens with it picked, its name in the box;
 * one without the pin opens with the name typed and nothing picked, so it is searched again.
 */
function areaField(draft: Draft, w: DescribeWords): string {
  const { label, placeholder, hint } = w.field("area");
  const current = cleanAreas(draft.areaServed)[0];
  const picked = current && draft.lat && draft.lon ? current : null;
  return `<label class="wb-field" for="f-area">${esc(label)}
        <input id="f-area" name="areaSearch" type="text" value="${esc(current ? areaLabel(current) : "")}" autocomplete="off" maxlength="100"
          spellcheck="false" enterkeyhint="search" aria-controls="f-area-list"
          ${placeholder ? `placeholder="${esc(placeholder)}"` : ""}
          ${hint ? `aria-describedby="f-area-hint"` : ""} />
        ${hint ? `<span class="hint" id="f-area-hint">${esc(hint)}</span>` : ""}
      </label>
      <ul class="wb-area-list" id="f-area-list" aria-label="${esc(label)}" hidden></ul>
      <input type="hidden" name="area" value="${esc(picked?.code ?? "")}" />
      <input type="hidden" name="areaName" value="${esc(picked?.name ?? "")}" />`;
}

/** The where part of one kind: shown and reachable when it is the kind picked, hidden and inert otherwise. */
const part = (kind: Kind, on: boolean, cls: string, body: string) =>
  `<div${cls ? ` class="${cls}"` : ""} data-kind-part="${kind}"${on ? "" : " hidden inert"}>${body}</div>`;

/**
 * Under street and city: the pin line, and the two fallbacks where.ts opens
 * when the geocoder can't answer for everything (a country, the coordinates).
 */
function whereOut(draft: Draft, w: DescribeWords): string {
  const line = pinLine(draft, w);
  // Resumed (AC7): a pin set by hand reopens the fallbacks it was typed in. A network's pin is never by hand.
  const byHand = draft.kind !== "network" && !!draft.lat && !draft.place;
  // A network's country is its area's: never asked.
  const needCountry = draft.kind !== "network" && ((!!draft.lat && !draft.country) || byHand);
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
        <input type="hidden" name="place" value="${esc(draft.place ?? "")}" />
        <input type="hidden" name="fidelity" value="${esc(draft.fidelity ?? "")}" />`;
}

/**
 * The key where.ts asks under, for a draft that already has its pin: a
 * resumed draft (AC7) doesn't ask the geocoder again for what it answered.
 * A country typed by hand is part of the ask; a derived one isn't (where.ts).
 */
function locatedKey(draft: Draft): string | null {
  if (draft.kind === "network") {
    const area = cleanAreas(draft.areaServed)[0];
    return draft.lat && draft.lon && area ? `area|${area.code}` : null;
  }
  if (!draft.lat || !draft.lon || !draft.place || !draft.city) return null;
  return `${draft.street ?? ""}|${draft.city}|`;
}

export function renderDescribeForm(draft: Draft, w: DescribeWords): string {
  const [name, street, city] = BEDROCK.map((f) => field(f, draft, w));
  const network = draft.kind === "network";
  const kind: Kind = network ? "network" : "space";
  // Where is the city for a space, the area for a network.
  const where = network ? !!cleanAreas(draft.areaServed).length : !!draft.city;
  // A network serving areas in several countries has no country: its area is what it needs.
  const ready = !!(draft.name && where && draft.lat && draft.lon && (network || draft.country));
  const located = locatedKey(draft);
  const typed = FIELDS.some((f) => draft[f.key]) || (network && where);
  // Anything optional already typed keeps the fold open: nothing typed hides behind it.
  const more = OPTIONAL.some((f) => draft[f.key]);
  return `
    <form id="f-describe" class="wb-form${more ? " more-open" : ""}" novalidate${located ? ` data-located="${esc(located)}"` : ""}>
      ${kindChoice(kind, w)}
      ${name}
      ${beat("where", !!draft.name, `${part("space", !network, "wb-doors", `${street}${city}`)}${part("network", network, "", areaField(draft, w))}${whereOut(draft, w)}`)}
      ${beat(
        "rest",
        !!draft.name && where,
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

/**
 * Reads the form back into the draft. Only what was typed: empty stays empty. A space's draft holds no area
 * and no kind (absent is a space); a network's holds no street, city or postcode.
 */
export function readDescribeForm(form: HTMLFormElement, draft: Draft): void {
  const data = new FormData(form);
  for (const key of [...FIELDS.map((f) => f.key), ...WHERE]) {
    const value = String(data.get(key) ?? "").trim();
    if (value) draft[key] = value;
    else delete draft[key];
  }
  if (kindOf(form) === "network") {
    draft.kind = "network";
    for (const key of SPACE_ONLY) delete draft[key];
    const picked = areaOf(form);
    const name = String(data.get("areaName") ?? "").trim();
    // One area is picked here. A draft read from the pod with several shows the first: left as it is, it keeps them all.
    const kept = cleanAreas(draft.areaServed);
    if (!picked) delete draft.areaServed;
    else if (kept[0]?.code !== picked) draft.areaServed = cleanAreas([{ code: picked, name }]);
    // The same area picked again names it (one read from a #67 file had no name); the others stay as they are.
    else if (name && kept[0].name !== name) draft.areaServed = cleanAreas([{ code: picked, name }, ...kept.slice(1)]);
    // The country is the one all its areas share, or none (the form's holds the first area's only).
    const country = draft.areaServed ? areasCountry(draft.areaServed) : null;
    if (country) draft.country = country;
    else delete draft.country;
    const fidelity = String(data.get("fidelity") ?? "").trim();
    if (fidelity) draft.fidelity = fidelity;
    else delete draft.fidelity;
  } else {
    delete draft.kind;
    delete draft.areaServed;
    delete draft.fidelity;
  }
}

/** The kind picked in the form: a space unless a network is. */
export function kindOf(form: HTMLFormElement): Kind {
  return (form.elements.namedItem("kind") as HTMLInputElement | null)?.value === "network" ? "network" : "space";
}

/**
 * Picks the kind in place: the buttons, the name's label, which where part is shown. What was typed in the
 * other part stays in its fields (switching back finds it); the pin goes, it was for the other where.
 * Returns true when the kind changed.
 */
export function setKind(form: HTMLFormElement, kind: Kind): boolean {
  const hidden = form.elements.namedItem("kind") as HTMLInputElement | null;
  if (!hidden || hidden.value === kind) return false;
  hidden.value = kind;
  for (const b of form.querySelectorAll<HTMLElement>("[data-kind]")) b.setAttribute("aria-pressed", String(b.dataset.kind === kind));
  for (const p of form.querySelectorAll<HTMLElement>("[data-kind-part]")) {
    const on = p.dataset.kindPart === kind;
    p.hidden = !on;
    p.toggleAttribute("inert", !on);
  }
  const label = form.querySelector<HTMLElement>('label[for="f-name"]');
  const name = label?.querySelector(".wb-field-name");
  if (label && name) name.textContent = (kind === "network" ? label.dataset.labelNetwork : label.dataset.labelSpace) ?? "";
  // The rest opens on the where of the kind picked.
  if (filled(form, "name") && whereFilled(form)) reveal(form, "rest");
  return true;
}

/** The where of the kind picked is given: the city for a space, the area for a network. */
function whereFilled(form: HTMLFormElement): boolean {
  return kindOf(form) === "network" ? !!areaOf(form) : filled(form, "city");
}

/** The area picked, as a code the map reads; "" when none (typed but not picked is none). */
export function areaOf(form: HTMLFormElement): string {
  return cleanAreas([(form.elements.namedItem("area") as HTMLInputElement | null)?.value ?? ""])[0]?.code ?? "";
}

/** The box a network's area is searched in. */
const areaBox = (form: HTMLFormElement) => form.querySelector<HTMLInputElement>("#f-area");

/** "Fill in an example": the tree's `onb:example`s, a space that doesn't exist. */
export function fillExample(form: HTMLFormElement, w: DescribeWords): void {
  for (const f of FIELDS) {
    const input = form.elements.namedItem(f.key) as HTMLInputElement | null;
    if (input) input.value = w.field(f.key).example ?? "";
  }
  // A network's example searches the tree's example area (the page asks for it; the pick is the coordinator's).
  const box = areaBox(form);
  if (box && kindOf(form) === "network") box.value = w.field("area").example ?? "";
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
  if (cta) cta.disabled = !(filled(form, "name") && whereFilled(form) && pinned(form));
  // Nothing typed: the example. Something typed: the way back to nothing (AC7, the draft is kept).
  const typed = FIELDS.some((f) => filled(form, f.key)) || (kindOf(form) === "network" && !!areaBox(form)?.value.trim());
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
  if (kindOf(form) === "network") {
    // A pick brings its pin: no area picked (or none with a pin) sends focus back to the box.
    if (areaOf(form) && pinned(form)) return null;
    reveal(form, "where");
    return areaBox(form);
  }
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

/** An area picked: the rest opens (the name given), and focus, on the offer that went with the list, goes to the box. */
export function areaPicked(form: HTMLFormElement): void {
  if (areaOf(form) && filled(form, "name")) reveal(form, "rest");
  areaBox(form)?.focus();
}

/**
 * Tab or Enter moves on, the way genjson does: the name and the city commit
 * and open the next beat; Enter in the street goes to the city, and in an
 * optional field to the next one. Empty, a required field doesn't move on
 * (Tab still leaves it as usual). Shift+Tab is never touched.
 */
export function describeKeydown(form: HTMLFormElement, event: KeyboardEvent): void {
  const target = event.target;
  if (target instanceof HTMLButtonElement && target.classList.contains("wb-area-option")) return areaKeydown(form, target, event);
  if (!(target instanceof HTMLInputElement)) return;
  if (target.name === "areaSearch") {
    // Enter never submits from the box: the page asks at once (or again). Arrow down goes into the offers.
    if (event.key === "Enter") event.preventDefault();
    if (event.key === "ArrowDown") {
      const first = form.querySelector<HTMLElement>(".wb-area-option");
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
    return;
  }
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
      if (kindOf(form) === "network") {
        event.preventDefault();
        areaBox(form)?.focus();
      } else go("street");
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

/** In the offers: arrows move between them (up from the first goes back to the box), Escape goes back to the box. */
function areaKeydown(form: HTMLFormElement, option: HTMLButtonElement, event: KeyboardEvent): void {
  const options = [...form.querySelectorAll<HTMLElement>(".wb-area-option")];
  const at = options.indexOf(option);
  const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
  if (event.key === "Escape" || (step === -1 && at === 0)) {
    event.preventDefault();
    areaBox(form)?.focus();
  } else if (step) {
    event.preventDefault();
    options[Math.min(options.length - 1, Math.max(0, at + step))]?.focus();
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
