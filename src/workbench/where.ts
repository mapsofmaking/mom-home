/**
 * Where the space is (Story 14.2 AC5): the pin, worked out from what was
 * typed, never typed itself. genjson's geocoding, through the map's proxy on
 * home's own origin (`POST /api/geocode`, Nominatim; the gateway sends
 * `/api/*` to the map, so no CORS).
 *
 * A city is enough. With a street the geocoder is asked for the street; when
 * that finds nothing, it is asked again for the city alone, and the pin line
 * says so. Postcode and country come from the answer. The pin line names the
 * place found, so a wrong match shows ("Canal, Springfield" lands in Long
 * Eaton, UK). No country in the answer: a two-letter field. No answer: the
 * coordinates by hand. Everything typed is kept.
 *
 * The form holds the result in its own inputs (country, lat, lon, postcode,
 * place), so the draft reads it back like any field. What the pin line says
 * is the tree's (`onb:uiPin*`, 14.2 AC8).
 *
 * A network (2026-11-19) has no address: it serves an area, searched by name
 * anywhere (`{"area_search": "Flanders", "lang": "en"}`, the map's proxy).
 * After a pause in the typing the geocoder offers up to five areas; picking one
 * sets the area (its code and name) and the pin at its centre, with the
 * candidate's fidelity (`region`, `country`), in one go: no second ask. The
 * country is the area's own. Nothing to pick (no match, the geocoder busy or
 * away): no area and no pin, so no card yet; the line says so, and typing again
 * or Enter asks again. There are no coordinates by hand for a network: the area
 * is what the map reads, and only the geocoder names one.
 */
import type { DescribeWords } from "./describe";
import { AREA_CODE, areaFidelity, areaLabel, cleanAreas, cleanFidelity } from "../lib/spacefile";
import { announce } from "../ui/a11y";

/** The wait has a floor so the pin reads as worked out, not magicked (genjson). */
export const timing = { minWait: 2300, retryGap: 1100, tick: 110, areaGap: 400 };

interface Answer {
  lat: number | null;
  lon: number | null;
  country_code: string | null;
  postcode: string | null;
  display_name: string | null;
  /** How coarse the answer is (the proxy says it since 2026-11-19); absent from older answers. */
  fidelity?: string | null;
}

type Outcome = Answer | "unavailable" | "rate";

async function ask(street: string, city: string, country: string): Promise<Outcome> {
  const answer = await post<Answer>({ address: street, city, postcode: "", country_code: country });
  return answer === "invalid" ? "unavailable" : answer;
}

/** The one request to the map's geocode proxy (an address or an area search); leaves nothing anywhere. */
async function post<T>(body: object): Promise<T | "unavailable" | "rate" | "invalid"> {
  try {
    const res = await fetch("/api/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429) return "rate";
    // The proxy refused what was sent (422): asking again with the same text can't help.
    if (res.status === 422) return "invalid";
    if (!res.ok) return "unavailable";
    return (await res.json()) as T;
  } catch {
    return "unavailable";
  }
}

/** What the geocoder found for an address: the answer, and whether the street was missed (the town was found instead). */
export type Found = { answer: Answer & { lat: number; lon: number }; missed: boolean } | "rate" | "unavailable" | "none";

/**
 * Asks the geocoder for a street in a town; when the street finds nothing, for the town alone (the proxy takes
 * one request a second, so the second ask waits). Tile A's pin (`locate`) and tile C's move (14.6 S5) ask this way.
 */
export async function findPlace(street: string, city: string, country = ""): Promise<Found> {
  let answer = await ask(street, city, country);
  let missed = false;
  if (typeof answer === "object" && answer.lat === null && street) {
    await wait(timing.retryGap);
    answer = await ask("", city, country);
    missed = typeof answer === "object" && answer.lat !== null;
  }
  if (answer === "rate" || answer === "unavailable") return answer;
  if (answer.lat === null || answer.lon === null) return "none";
  return { answer: answer as Answer & { lat: number; lon: number }, missed };
}

/** An area the geocoder offers for what was typed: its code and name, its centre, how coarse that centre is. */
export interface Candidate {
  code: string;
  name: string;
  display_name: string;
  lat: number;
  lon: number;
  fidelity: string;
}

/** What the geocoder found for an area searched by name (a network's where): the areas to pick from, or why none. */
export type FoundAreas = Candidate[] | "rate" | "unavailable" | "none";

/** The most areas offered at once: enough to tell Flanders from West Flanders, short enough to stay inline. */
export const MAX_CANDIDATES = 5;

/**
 * Asks the geocoder for the areas a name could be. An offer without a code the map reads, a name or a centre on
 * the globe is left out: what is offered is what can be picked.
 */
export async function searchAreas(text: string): Promise<FoundAreas> {
  const answer = await post<{ candidates?: unknown } | null>({ area_search: text, lang: "en" });
  if (answer === "rate" || answer === "unavailable") return answer;
  // Text the proxy won't search (422): said as no match, so nobody is told to retry the same thing.
  if (answer === "invalid") return "none";
  const list = answer?.candidates;
  const out: Candidate[] = [];
  for (const c of Array.isArray(list) ? list : []) {
    if (!c || typeof c !== "object") continue;
    const { code, name, display_name, lat, lon, fidelity } = c as Record<string, unknown>;
    const area = cleanAreas([{ code, name }])[0];
    if (!area || !area.name || typeof lat !== "number" || typeof lon !== "number") continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    if (out.some((o) => o.code === area.code)) continue;
    out.push({
      ...area,
      display_name: typeof display_name === "string" ? display_name : "",
      lat,
      lon,
      fidelity: cleanFidelity(typeof fidelity === "string" ? fidelity : undefined) ?? areaFidelity(area.code),
    });
  }
  return out.length ? out.slice(0, MAX_CANDIDATES) : "none";
}

/** A candidate as the list shows it: "Flanders, Belgium" for a region, "France" for a country. */
export function candidateLabel(c: { code: string; name: string }): string {
  const country = c.code.includes("-") ? areaLabel({ code: c.code.slice(0, 2), name: "" }) : "";
  return country && country !== c.name ? `${c.name}, ${country}` : c.name;
}

/**
 * The place, short enough to read at a glance: Nominatim's first three parts,
 * each cut at its first " - " (Brussels' names come in three languages).
 */
export function shortPlace(displayName: string | null | undefined): string {
  const parts = String(displayName ?? "")
    .split(",")
    .map((p) => p.split(" - ")[0].trim())
    .filter(Boolean);
  return [...new Set(parts)].slice(0, 3).join(", ");
}

/** The pin line for a draft or the form's own values. Empty until there is a pin. */
export function pinLine(
  v: { lat?: string; lon?: string; place?: string; postcode?: string; country?: string },
  w: DescribeWords
): string {
  if (!v.lat || !v.lon) return "";
  const tail = [v.place, v.postcode, v.country].filter(Boolean).join(" · ");
  // Four decimals is about 10 m: enough to read, the inputs keep the full value.
  const short = (n: string) => (Number.isFinite(Number(n)) ? String(Math.round(Number(n) * 1e4) / 1e4) : n);
  return `${w.ui(v.place ? "uiPinFound" : "uiPinByHand")} ${short(v.lat)}, ${short(v.lon)}${tail ? ` · ${tail}` : ""}`;
}

const field = (form: HTMLFormElement, name: string) => form.elements.namedItem(name) as HTMLInputElement | null;
const value = (form: HTMLFormElement, name: string) => field(form, name)?.value.trim() ?? "";
const set = (form: HTMLFormElement, name: string, v: string) => {
  const el = field(form, name);
  if (el) el.value = v;
};
const show = (form: HTMLFormElement, which: "country" | "coords", on: boolean) => {
  const el = form.querySelector<HTMLElement>(`[data-manual="${which}"]`);
  if (el) el.hidden = !on;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Writes the line under the address; `tone` colours it (design system: ok is the done tint, error the riso red). */
function say(form: HTMLFormElement, text: string, tone: "" | "ok" | "error" | "working" = "", note = "") {
  const el = form.querySelector<HTMLElement>("#f-pin");
  if (!el) return;
  el.textContent = "";
  const line = document.createElement("span");
  line.className = "wb-pin-line";
  line.textContent = text;
  el.append(line);
  if (note) {
    const n = document.createElement("span");
    n.className = "wb-pin-note";
    n.textContent = note;
    el.prepend(n);
  }
  el.className = `wb-pin${tone ? ` ${tone}` : ""}`;
}

/**
 * Bernard's labour made visible: a bar that cycles while the geocoder works. Reduced motion: the words alone.
 * `write` shows a line (the form's pin line on tile A, the tool's address line); returns the stop.
 */
export function meterInto(write: (text: string, tone: "working") => void, working: string): () => void {
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  write(working, "working");
  if (reduce || !timing.tick) return () => {};
  let n = 0;
  const id = setInterval(() => {
    n = (n + 1) % 12;
    write(`${working} ${"▰".repeat(n)}${"▱".repeat(11 - n)}`, "working");
  }, timing.tick);
  return () => clearInterval(id);
}

function meter(form: HTMLFormElement, w: DescribeWords): () => void {
  return meterInto((text, tone) => say(form, text, tone), w.ui("uiPinWorking"));
}

const isNetwork = (form: HTMLFormElement) => value(form, "kind") === "network";
/** The area picked (hidden in the form, set only by a pick): its code, "" when none. */
const areaIn = (form: HTMLFormElement) => (AREA_CODE.test(value(form, "area")) ? value(form, "area") : "");

/** True when the form has everything the card needs from where: a country and a pin (a network: an area too). */
export function pinned(form: HTMLFormElement): boolean {
  const lat = Number(value(form, "lat"));
  const lon = Number(value(form, "lon"));
  return (
    // A network needs its area, not a country: one serving areas in several countries has none (the writers
    // then leave the country out, and the map derives one only when all areas share it).
    (isNetwork(form) ? !!areaIn(form) : /^[A-Z]{2}$/.test(value(form, "country"))) &&
    value(form, "lat") !== "" && value(form, "lon") !== "" &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  );
}

/** Street, city or the area typed changed: the old pin no longer holds, nor the area picked with it. */
export function unpin(form: HTMLFormElement): void {
  for (const name of ["lat", "lon", "postcode", "place", "fidelity", "area", "areaName"]) set(form, name, "");
  if (form.querySelector<HTMLElement>('[data-manual="country"]')?.hidden) set(form, "country", "");
  delete form.dataset.located;
  delete form.dataset.pinFile;
  // A search on its way is moot too (the kind switched, or the text changed). The offers stay until the next
  // answer replaces them (or the text gets too short): no flicker while typing.
  searches.delete(form);
  say(form, "");
}

/** The coordinates typed by hand: the pin line follows them, with no place (nothing was found). */
export function pinByHand(form: HTMLFormElement, w: DescribeWords): void {
  set(form, "place", "");
  say(form, pinLine({ lat: value(form, "lat"), lon: value(form, "lon"), country: value(form, "country") }, w), pinned(form) ? "ok" : "");
}

/**
 * Asks the geocoder for what is typed, once per street|city|country. A newer
 * ask makes an older answer moot. `done` runs when the form changed (the
 * button may turn on).
 */
export async function locate(form: HTMLFormElement, w: DescribeWords, done: () => void = () => {}, now = false): Promise<void> {
  if (isNetwork(form)) return searchArea(form, w, done, now);
  const street = value(form, "street");
  const city = value(form, "city");
  // The country sharpens the ask only when typed by hand; a derived one would make every ask new.
  const typed = !form.querySelector<HTMLElement>('[data-manual="country"]')?.hidden;
  const country = typed ? value(form, "country") : "";
  if (!city) return;
  const key = `${street}|${city}|${country}`;
  if (form.dataset.located === key) return;
  // The imported file's pin (#73): a country typed after it fills the country, it doesn't move the pin.
  if (form.dataset.pinFile && form.dataset.located === `${street}|${city}|` && value(form, "lat") && value(form, "lon")) {
    form.dataset.located = key;
    done();
    return;
  }
  form.dataset.located = key;

  const started = Date.now();
  const stop = meter(form, w);
  const found = await findPlace(street, city, country);
  await wait(Math.max(0, timing.minWait - (Date.now() - started)));
  stop();
  if (form.dataset.located !== key) return; // something newer was typed

  if (typeof found !== "object") {
    const answer = found;
    const text = w.ui(answer === "rate" ? "uiRate" : answer === "unavailable" ? "uiUnavailable" : "uiNoResult");
    say(form, text, "error");
    if (answer !== "rate") {
      show(form, "coords", true);
      show(form, "country", true);
      delete form.dataset.located; // leaving the city again asks again
    } else delete form.dataset.located;
    done();
    return;
  }

  const { answer, missed } = found;
  set(form, "lat", String(answer.lat));
  set(form, "lon", String(answer.lon));
  set(form, "postcode", answer.postcode ?? "");
  set(form, "place", shortPlace(answer.display_name));
  if (answer.country_code) {
    set(form, "country", answer.country_code.toUpperCase());
    show(form, "country", false);
  } else show(form, "country", true);
  show(form, "coords", false);
  const line = pinLine({
    lat: String(answer.lat),
    lon: String(answer.lon),
    place: shortPlace(answer.display_name),
    postcode: answer.postcode ?? "",
    country: value(form, "country"),
  }, w);
  say(form, line, "ok", missed ? w.ui("uiStreetMissed", { city }) : "");
  done();
}

/**
 * The proxy takes one request a second: every search waits its turn in one queue (so two forms, or two calls
 * at once, can't both slip through), a second after the one before, and is dropped at its turn when its text
 * is no longer the one in the box.
 */
let queue: Promise<unknown> = Promise.resolve();
let lastAsk = 0;

function spaced<T>(still: () => boolean, run: () => Promise<T>): Promise<T | null> {
  const turn = queue.then(async () => {
    if (!still()) return null;
    await wait(Math.max(0, lastAsk + timing.retryGap - Date.now()));
    if (!still()) return null;
    lastAsk = Date.now();
    return run();
  });
  queue = turn.catch(() => null);
  return turn;
}

/** The one search a form has going: its text, where it is, and (while it pauses) the way to stop pausing. */
interface Search {
  key: string;
  phase: "pausing" | "asking" | "offered" | "nothing";
  wake?: () => void;
}
const searches = new WeakMap<HTMLFormElement, Search>();

const areaList = (form: HTMLFormElement) => form.querySelector<HTMLElement>("#f-area-list");
/** What the offers are, to tell the same list from a new one. */
const signature = (candidates: readonly Candidate[]) => JSON.stringify(candidates.map((c) => [c.code, c.name, c.lat, c.lon, c.fidelity]));

/**
 * The areas offered, as buttons under the box (each carries what a pick sets); none hides the list. The same
 * offers again leave the list as it is, so focus and the arrow keys' place in it hold.
 */
function offer(form: HTMLFormElement, candidates: readonly Candidate[]): void {
  const list = areaList(form);
  if (!list) return;
  const sig = signature(candidates);
  if (list.dataset.offers === sig) return;
  list.dataset.offers = sig;
  list.textContent = "";
  for (const c of candidates) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn wb-area-option";
    // The geocoder's words go in as text, never as markup.
    button.textContent = candidateLabel(c);
    Object.assign(button.dataset, {
      areaCode: c.code, areaName: c.name, lat: String(c.lat), lon: String(c.lon), fidelity: c.fidelity, place: shortPlace(c.display_name),
    });
    item.append(button);
    list.append(item);
  }
  list.hidden = !candidates.length;
}

/**
 * A network's where: asks the geocoder for the areas the box's text could be, once the typing pauses (or at
 * once, `now`: Enter). Two letters at least. A newer text, a pick or a redraw makes an older answer moot.
 * The same text again never asks twice: Enter during the pause ends the pause, Enter while it asks or once
 * its offers show does nothing; only after nothing came back does Enter ask again.
 */
async function searchArea(form: HTMLFormElement, w: DescribeWords, done: () => void, now: boolean): Promise<void> {
  if (areaIn(form)) return; // picked: the pin came with it
  const text = value(form, "areaSearch");
  const key = `search|${text}`;
  const going = searches.get(form);
  if (going?.key === key) {
    if (going.phase === "pausing" && now) going.wake?.();
    if (going.phase !== "nothing" || !now) return;
  }
  if (text.length < 2) {
    searches.delete(form);
    offer(form, []);
    say(form, "");
    return;
  }
  const search: Search = { key, phase: "pausing" };
  searches.set(form, search);
  const current = () => searches.get(form) === search && form.isConnected && !areaIn(form);
  if (!now) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timing.areaGap);
      search.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
  search.wake = undefined;
  if (!current()) return;
  search.phase = "asking";
  const found = await spaced(current, () => {
    say(form, w.ui("uiPinWorking"), "working");
    return searchAreas(text);
  });
  if (found === null || !current()) return; // typed again, picked or redrawn
  if (typeof found !== "object") {
    search.phase = "nothing";
    offer(form, []);
    say(form, w.ui(found === "rate" ? "uiRateArea" : found === "unavailable" ? "uiUnavailableArea" : "uiNoResultArea"), "error");
    done();
    return;
  }
  search.phase = "offered";
  say(form, "");
  offer(form, found);
  announce(w.ui("uiAreaFound", { n: String(found.length) }));
  done();
}

/**
 * Picks an offered area: the area (code and name), its centre and fidelity, its country, the pin line, all from
 * the offer (no second ask). The list goes; the box says the name.
 */
export function pickArea(form: HTMLFormElement, option: HTMLElement, w: DescribeWords): void {
  const d = option.dataset;
  const area = cleanAreas([{ code: d.areaCode, name: d.areaName }])[0];
  if (!area || !d.lat || !d.lon) return;
  set(form, "area", area.code);
  set(form, "areaName", area.name);
  set(form, "areaSearch", area.name);
  set(form, "lat", d.lat);
  set(form, "lon", d.lon);
  set(form, "postcode", "");
  set(form, "place", d.place ?? "");
  set(form, "fidelity", cleanFidelity(d.fidelity) ?? areaFidelity(area.code));
  set(form, "country", area.code.slice(0, 2));
  show(form, "country", false);
  show(form, "coords", false);
  form.dataset.located = `area|${area.code}`;
  searches.delete(form); // the next search, whatever its text, is a new one
  offer(form, []);
  const line = pinLine({ lat: d.lat, lon: d.lon, place: d.place, country: area.code.slice(0, 2) }, w);
  say(form, line, "ok", w.ui("uiPinArea", { area: areaLabel(area) }));
}
