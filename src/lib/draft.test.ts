import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeDraftStore } from "./draft";

interface Recap {
  minutes: number;
  note: string;
}

const CARNET = "https://pod.example/alice/carnets/matin/";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("makeDraftStore", () => {
  it("round-trips a draft", () => {
    const drafts = makeDraftStore<Recap>("app:recap");

    drafts.save(CARNET, { minutes: 12, note: "ok" });

    expect(drafts.load(CARNET)).toEqual({ minutes: 12, note: "ok" });
  });

  it("returns null when there is no draft", () => {
    expect(makeDraftStore<Recap>("app:recap").load(CARNET)).toBeNull();
  });

  it("clears a draft", () => {
    const drafts = makeDraftStore<Recap>("app:recap");
    drafts.save(CARNET, { minutes: 1, note: "" });

    drafts.clear(CARNET);

    expect(drafts.load(CARNET)).toBeNull();
  });

  it("keeps drafts for different ids apart", () => {
    const drafts = makeDraftStore<Recap>("app:recap");
    const other = "https://pod.example/alice/carnets/soir/";

    drafts.save(CARNET, { minutes: 1, note: "morning" });
    drafts.save(other, { minutes: 2, note: "evening" });

    expect(drafts.load(CARNET)?.note).toBe("morning");
    expect(drafts.load(other)?.note).toBe("evening");
  });

  it("namespaces by prefix, so two apps on one origin never collide", () => {
    const a = makeDraftStore<Recap>("valisette:triage");
    const b = makeDraftStore<Recap>("sportr:recap");

    a.save(CARNET, { minutes: 1, note: "from a" });
    b.save(CARNET, { minutes: 2, note: "from b" });

    expect(a.load(CARNET)?.note).toBe("from a");
    expect(b.load(CARNET)?.note).toBe("from b");
  });

  it("expires a draft past maxAgeMs AND removes it", () => {
    vi.useFakeTimers();
    try {
      const drafts = makeDraftStore<Recap>("app:recap", 60_000);
      drafts.save(CARNET, { minutes: 1, note: "stale" });

      vi.advanceTimersByTime(60_001);

      expect(drafts.load(CARNET)).toBeNull();
      // Expiry must clean up, not just hide: otherwise dead drafts accumulate
      // in storage until the quota trips.
      expect(localStorage.getItem(`app:recap:${CARNET}`)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a draft that is still within maxAgeMs", () => {
    vi.useFakeTimers();
    try {
      const drafts = makeDraftStore<Recap>("app:recap", 60_000);
      drafts.save(CARNET, { minutes: 1, note: "fresh" });

      vi.advanceTimersByTime(59_000);

      expect(drafts.load(CARNET)?.note).toBe("fresh");
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats unparseable storage as no draft rather than throwing", () => {
    localStorage.setItem(`app:recap:${CARNET}`, "{not json");

    expect(makeDraftStore<Recap>("app:recap").load(CARNET)).toBeNull();
  });

  it("survives a localStorage that throws on write (private mode, quota)", () => {
    const drafts = makeDraftStore<Recap>("app:recap");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    // Losing the draft is acceptable; crashing the screen the user is working
    // in is not.
    expect(() => drafts.save(CARNET, { minutes: 1, note: "x" })).not.toThrow();
  });

  it("survives a localStorage that throws on read and on clear", () => {
    const drafts = makeDraftStore<Recap>("app:recap");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });

    expect(drafts.load(CARNET)).toBeNull();
    expect(() => drafts.clear(CARNET)).not.toThrow();
  });
});
