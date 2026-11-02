import { describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({ authFetch: vi.fn() }));
import { MAX_NAME, podAddress, podNameProblem, suggestPodName } from "./podname";

describe("podNameProblem", () => {
  it("accepts a DNS label", () => {
    for (const ok of ["a", "weld-done", "atelier-du-canal-2", "0xff", "a".repeat(MAX_NAME)]) expect(podNameProblem(ok), ok).toBeNull();
  });
  it("names the problem, so each shows its own line", () => {
    expect(podNameProblem("")).toBe("empty");
    for (const bad of ["-a", "a-", "Weld", "weld done", "weld_done", "été", "a.b", "a/b"]) expect(podNameProblem(bad), bad).toBe("format");
    expect(podNameProblem("a".repeat(MAX_NAME + 1))).toBe("long");
  });
});

describe("suggestPodName", () => {
  it("folds accents and joins words with dashes", () => {
    expect(suggestPodName("Atelier du Canal")).toBe("atelier-du-canal");
    expect(suggestPodName("L'Étincelle & Cie")).toBe("l-etincelle-cie");
  });
  it("suggests nothing rather than 'item' when the name has nothing usable", () => {
    expect(suggestPodName("")).toBe("");
    expect(suggestPodName(undefined)).toBe("");
    expect(suggestPodName("☃ !!!")).toBe("");
  });
  it("cuts to the limit without leaving a dash at the end, and what it suggests is always valid", () => {
    const long = `${"a".repeat(62)} b`;
    const s = suggestPodName(long);
    expect(s.length).toBeLessThanOrEqual(MAX_NAME);
    expect(s.endsWith("-")).toBe(false);
    expect(podNameProblem(s)).toBeNull();
  });
});

describe("podAddress", () => {
  it("is a subdomain of the server's host", () => {
    expect(podAddress("weld-done", "https://pod.example.org/")).toBe("https://weld-done.pod.example.org");
  });
});
