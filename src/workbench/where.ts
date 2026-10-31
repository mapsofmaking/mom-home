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
 * place), so the draft reads it back like any field.
 */

/** The wait has a floor so the pin reads as worked out, not magicked (genjson). */
export const timing = { minWait: 2300, retryGap: 1100, tick: 110 };

export const SAY = {
  working: "Working out where that is.",
  found: "Dropping the pin here:",
  byHand: "Pin set by hand:",
  streetMissed: (city: string) => `No match for the street, so the pin sits in ${city}'s centre.`,
  noResult: "The geocoder (OpenStreetMap) can't place that. Check the city, or enter the coordinates below.",
  unavailable: "The geocoder isn't answering right now. Enter the coordinates below, or leave the city field again in a moment.",
  rate: "Too many requests to the geocoder. Wait a moment, then leave the city field again.",
};

interface Answer {
  lat: number | null;
  lon: number | null;
  country_code: string | null;
  postcode: string | null;
  display_name: string | null;
}

type Outcome = Answer | "unavailable" | "rate";

async function ask(street: string, city: string, country: string): Promise<Outcome> {
  try {
    const res = await fetch("/api/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: street, city, postcode: "", country_code: country }),
    });
    if (res.status === 429) return "rate";
    if (!res.ok) return "unavailable";
    return (await res.json()) as Answer;
  } catch {
    return "unavailable";
  }
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
export function pinLine(v: { lat?: string; lon?: string; place?: string; postcode?: string; country?: string }): string {
  if (!v.lat || !v.lon) return "";
  const tail = [v.place, v.postcode, v.country].filter(Boolean).join(" · ");
  // Four decimals is about 10 m: enough to read, the inputs keep the full value.
  const short = (n: string) => (Number.isFinite(Number(n)) ? String(Math.round(Number(n) * 1e4) / 1e4) : n);
  return `${v.place ? SAY.found : SAY.byHand} ${short(v.lat)}, ${short(v.lon)}${tail ? ` · ${tail}` : ""}`;
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

/** Bernard's labour made visible: a bar that cycles while the geocoder works. Reduced motion: the words alone. */
function meter(form: HTMLFormElement): () => void {
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  say(form, SAY.working, "working");
  if (reduce || !timing.tick) return () => {};
  let n = 0;
  const id = setInterval(() => {
    n = (n + 1) % 12;
    say(form, `${SAY.working} ${"▰".repeat(n)}${"▱".repeat(11 - n)}`, "working");
  }, timing.tick);
  return () => clearInterval(id);
}

/** True when the form has everything the card needs from where: a country and a pin. */
export function pinned(form: HTMLFormElement): boolean {
  const lat = Number(value(form, "lat"));
  const lon = Number(value(form, "lon"));
  return (
    /^[A-Z]{2}$/.test(value(form, "country")) &&
    value(form, "lat") !== "" && value(form, "lon") !== "" &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  );
}

/** Street or city changed: the old pin no longer holds. */
export function unpin(form: HTMLFormElement): void {
  for (const name of ["lat", "lon", "postcode", "place"]) set(form, name, "");
  if (form.querySelector<HTMLElement>('[data-manual="country"]')?.hidden) set(form, "country", "");
  delete form.dataset.located;
  say(form, "");
}

/** The coordinates typed by hand: the pin line follows them, with no place (nothing was found). */
export function pinByHand(form: HTMLFormElement): void {
  set(form, "place", "");
  say(form, pinLine({ lat: value(form, "lat"), lon: value(form, "lon"), country: value(form, "country") }), pinned(form) ? "ok" : "");
}

/**
 * Asks the geocoder for what is typed, once per street|city|country. A newer
 * ask makes an older answer moot. `done` runs when the form changed (the
 * button may turn on).
 */
export async function locate(form: HTMLFormElement, done: () => void = () => {}): Promise<void> {
  const street = value(form, "street");
  const city = value(form, "city");
  // The country sharpens the ask only when typed by hand; a derived one would make every ask new.
  const typed = !form.querySelector<HTMLElement>('[data-manual="country"]')?.hidden;
  const country = typed ? value(form, "country") : "";
  if (!city) return;
  const key = `${street}|${city}|${country}`;
  if (form.dataset.located === key) return;
  form.dataset.located = key;

  const started = Date.now();
  const stop = meter(form);
  let answer = await ask(street, city, country);
  let missed = false;
  if (typeof answer === "object" && answer.lat === null && street) {
    await wait(timing.retryGap); // the proxy takes one request a second
    answer = await ask("", city, country);
    missed = typeof answer === "object" && answer.lat !== null;
  }
  await wait(Math.max(0, timing.minWait - (Date.now() - started)));
  stop();
  if (form.dataset.located !== key) return; // something newer was typed

  if (answer === "rate" || answer === "unavailable" || answer.lat === null || answer.lon === null) {
    const text = answer === "rate" ? SAY.rate : answer === "unavailable" ? SAY.unavailable : SAY.noResult;
    say(form, text, "error");
    if (answer !== "rate") {
      show(form, "coords", true);
      show(form, "country", true);
      delete form.dataset.located; // leaving the city again asks again
    } else delete form.dataset.located;
    done();
    return;
  }

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
  });
  say(form, line, "ok", missed ? SAY.streetMissed(city) : "");
  done();
}
