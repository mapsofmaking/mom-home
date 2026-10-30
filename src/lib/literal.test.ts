import { describe, it, expect } from "vitest";
import { buildThing, createThing } from "@inrupt/solid-client";
import { readLiteral } from "./literal";

const P = "https://example.org/ns#title";

describe("readLiteral", () => {
  it("reads an untagged literal with no preference given", () => {
    const thing = buildThing(createThing()).setStringNoLocale(P, "Échauffement").build();
    expect(readLiteral(thing, P)).toBe("Échauffement");
  });

  it("prefers the first preferred language over the untagged form", () => {
    const thing = buildThing(createThing())
      .setStringNoLocale(P, "untagged")
      .setStringWithLocale(P, "Échauffement", "fr")
      .build();
    expect(readLiteral(thing, P, ["fr", "en"])).toBe("Échauffement");
  });

  it("falls back to the untagged form when the first preference is absent", () => {
    const thing = buildThing(createThing()).setStringNoLocale(P, "untagged").build();
    expect(readLiteral(thing, P, ["fr", "en"])).toBe("untagged");
  });

  it("falls back to a later preferred language when neither the first nor the untagged form exists", () => {
    const thing = buildThing(createThing()).setStringWithLocale(P, "Warm-up", "en").build();
    expect(readLiteral(thing, P, ["fr", "en"])).toBe("Warm-up");
  });

  it("returns null when nothing matches", () => {
    const thing = buildThing(createThing()).setStringNoLocale("https://example.org/ns#other", "x").build();
    expect(readLiteral(thing, P, ["fr", "en"])).toBeNull();
  });
});
