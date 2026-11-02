import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Offers } from "../lib/provider";
import { parseTree } from "../tree/parse";
import { renderPage } from "./page";
import type { Draft } from "./previews";

const tree = parseTree(readFileSync(join(__dirname, "../../public/onboarding.ttl"), "utf8"));
const keep = tree.tiles.find((t) => t.id === "keep")!;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { disconnect() {} observe() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {} }));
});

const settle = () => new Promise((r) => setTimeout(r, 0));

/** Tile B opened on the pod door's form, tile A done with this draft. */
async function openForm(draft: Draft = { name: "Atelier du Canal", city: "Anderlecht", email: "hello@atelier.example" }, offers: Offers = "open") {
  const root = document.createElement("div");
  document.body.append(root);
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  renderPage(root, tree, {
    mode: "onboarding", done: new Set(["describe"]), draft, fold: { folded: false },
    onSignIn: () => {}, onSignOut: () => {}, readOffers: async () => offers,
  });
  await settle();
  root.querySelector<HTMLElement>('[data-door="pod"]')!.click();
  const form = root.querySelector<HTMLFormElement>("#f-pod")!;
  const f = (id: string) => root.querySelector<HTMLInputElement>(`#p-${id}`)!;
  const err = (id: string) => root.querySelector<HTMLElement>(`#p-${id}-err`)!;
  const type = (id: string, value: string) => {
    f(id).value = value;
    f(id).dispatchEvent(new Event("input", { bubbles: true }));
  };
  const leave = (id: string) => f(id).dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  const submit = () => {
    const e = new Event("submit", { cancelable: true, bubbles: true });
    form.dispatchEvent(e);
    return e;
  };
  return { root, form, f, err, type, leave, submit, fetchSpy };
}

describe("the pod form (14.3 AC2)", () => {
  it("opens in place of the doors, headed by the door's name, with only what's missing", async () => {
    const { root, form } = await openForm();
    expect(root.querySelector(".wb-step-title")!.textContent).toBe(keep.ui.uiDoorPod);
    expect(root.querySelector(".wb-doors")).toBeNull();
    expect([...form.elements].filter((e) => e.tagName === "INPUT").map((e) => (e as HTMLInputElement).name)).toEqual(["name", "email", "pass", "pass2"]);
  });

  it("suggests the address from the space's name, shows its full URL, and takes the email from the description", async () => {
    const { f, root } = await openForm();
    expect(f("name").value).toBe("atelier-du-canal");
    expect(root.querySelector("#p-name-hint")!.textContent).toBe("https://atelier-du-canal.pod.mapsofmaking.org");
    expect(f("email").value).toBe("hello@atelier.example");
  });

  it("suggests nothing, and says nothing yet, when the name has no usable letters", async () => {
    const { f, err } = await openForm({ name: "☃ !!!", city: "Anderlecht" });
    expect(f("name").value).toBe("");
    expect(err("name").hidden).toBe(true);
  });

  it("types over the suggestion: the URL follows live, the format shows after a pause or on leaving", async () => {
    // Fake timers only once the form is open: openForm itself waits on a real timer.
    const { root, f, err, type } = await openForm();
    vi.useFakeTimers();
    try {
      type("name", "Weld Done");
      expect(root.querySelector("#p-name-hint")!.textContent).toBe("https://Weld Done.pod.mapsofmaking.org");
      expect(err("name").hidden).toBe(true);
      vi.advanceTimersByTime(700);
      expect(err("name").textContent).toBe(keep.ui.uiAddrBad);
      expect(f("name").getAttribute("aria-invalid")).toBe("true");
      type("name", "weld-done");
      expect(err("name").hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks the format the moment the field is left, and a too-long address says so", async () => {
    const { f, err, type, leave } = await openForm();
    type("name", "-nope");
    leave("name");
    expect(err("name").textContent).toBe(keep.ui.uiAddrBad);
    type("name", "a".repeat(64));
    leave("name");
    expect(err("name").textContent).toBe(keep.ui.uiAddrLong);
    type("name", "");
    leave("name");
    expect(err("name").textContent).toBe(keep.ui.uiAddrEmpty);
    expect(f("name").value).toBe("");
  });

  it("checks the suggested address as soon as the form opens", async () => {
    // 'x' repeated is valid; a name that slugs to a leading digit-only label is valid too: force a bad one through the draft's long name.
    const { err, f } = await openForm({ name: "a".repeat(80), city: "x" });
    expect(f("name").value.length).toBe(63);
    expect(err("name").hidden).toBe(true);
  });
});

describe("the passphrase (14.3 AC2, AC3)", () => {
  it("is typed twice, with one Show for both, and autocomplete says it is new", async () => {
    const { root, f } = await openForm();
    expect(f("pass").autocomplete).toBe("new-password");
    expect(f("pass2").autocomplete).toBe("new-password");
    const show = root.querySelector<HTMLButtonElement>("#pod-show")!;
    show.click();
    expect([f("pass").type, f("pass2").type]).toEqual(["text", "text"]);
    expect(show.getAttribute("aria-pressed")).toBe("true");
    expect(show.textContent).toBe(keep.ui.uiPodHide);
    show.click();
    expect([f("pass").type, f("pass2").type]).toEqual(["password", "password"]);
  });

  it("says what is wrong on its own field: too short, spaces, not matching", async () => {
    const { err, type, leave } = await openForm();
    type("pass", "short");
    leave("pass");
    expect(err("pass").textContent).toBe(keep.ui.uiPassShort);
    type("pass", "two words here");
    leave("pass");
    expect(err("pass").textContent).toBe(keep.ui.uiPassSpace);
    type("pass", "Rock-Paper-Scissors-Lizard-Spock");
    leave("pass");
    expect(err("pass").hidden).toBe(true);
    type("pass2", "Rock-Paper-Scissors");
    leave("pass2");
    expect(err("pass2").textContent).toBe(keep.ui.uiPassMismatch);
    type("pass2", "Rock-Paper-Scissors-Lizard-Spock");
    leave("pass2");
    expect(err("pass2").hidden).toBe(true);
  });

  it("leaving the first field says nothing about 'Same again' while it is still empty", async () => {
    const { err, type, leave } = await openForm();
    type("pass", "Rock-Paper-Scissors-Lizard-Spock");
    leave("pass");
    expect(err("pass2").hidden).toBe(true);
  });
});

describe("Create it (S2: nothing is sent)", () => {
  const good = "Rock-Paper-Scissors-Lizard-Spock";

  it("never lets the browser submit: a native submit would put the passphrase in the URL", async () => {
    const { submit, type } = await openForm();
    type("pass", good);
    type("pass2", good);
    expect(submit().defaultPrevented).toBe(true);
    // And with a problem too.
    type("pass2", "other");
    expect(submit().defaultPrevented).toBe(true);
  });

  it("the form is not a GET that could carry fields", async () => {
    const { form } = await openForm();
    expect(form.getAttribute("method")).toBe("post");
    expect(form.hasAttribute("novalidate")).toBe(true);
  });

  it("with a problem, lands on the first field that has one, and keeps every other message and everything typed", async () => {
    const { f, err, type, submit } = await openForm();
    type("email", "not-an-email");
    type("pass", good);
    type("pass2", "different");
    submit();
    expect(document.activeElement).toBe(f("email"));
    expect(err("email").textContent).toBe(keep.ui.uiEmailBad);
    expect(err("pass2").textContent).toBe(keep.ui.uiPassMismatch);
    expect(f("pass").value).toBe(good);
    expect(f("pass2").value).toBe("different");
    expect(f("email").value).toBe("not-an-email");
    expect(f("name").value).toBe("atelier-du-canal");
  });

  it("valid, it says the creation comes next, and sends nothing", async () => {
    const { root, type, submit, fetchSpy } = await openForm();
    type("pass", good);
    type("pass2", good);
    submit();
    expect(root.querySelector("#pod-status")!.textContent).toBe(keep.ui.uiPodStatus);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the passphrase is never copied into the page: back at the doors and into the form again, it is gone", async () => {
    // Not the form's own placeholder example, which is on the page by design.
    const secret = "correct-horse-battery-staple";
    const { root, type, f } = await openForm();
    type("pass", secret);
    type("pass2", secret);
    root.querySelector<HTMLElement>("#pod-other")!.click();
    root.querySelector<HTMLElement>('[data-door="pod"]')!.click();
    expect(f("pass").value).toBe("");
    expect(root.innerHTML).not.toContain(secret);
  });
});

describe("the other door, and what survives", () => {
  it("'Take the other door' goes back to the doors with the self-host answer", async () => {
    const { root } = await openForm();
    root.querySelector<HTMLElement>("#pod-other")!.click();
    expect(root.querySelector(".wb-doors")).not.toBeNull();
    expect(root.querySelector("#reply")!.textContent).toContain(keep.ui.uiSelfSoon);
  });

  it("an address and an email the coordinator typed come back; an untouched one follows the description", async () => {
    const draft: Draft = { name: "Atelier du Canal", city: "Anderlecht", email: "hello@atelier.example" };
    const { root, type, f } = await openForm(draft);
    type("name", "my-own-name");
    root.querySelector<HTMLElement>("#pod-other")!.click();
    draft.email = "changed@atelier.example";
    draft.name = "Another Name";
    root.querySelector<HTMLElement>('[data-door="pod"]')!.click();
    expect(f("name").value).toBe("my-own-name");
    expect(f("email").value).toBe("changed@atelier.example");
  });
});
