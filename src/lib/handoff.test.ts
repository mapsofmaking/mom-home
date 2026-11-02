import { afterEach, describe, expect, it } from "vitest";
import { clearPodMade, markPodMade, MARKER_MINUTES, peekPodMade, takePodMade } from "./handoff";

const made = { webId: "https://weld.pod.example/profile/card#me", pod: "https://weld.pod.example/" };
const T0 = 1_000_000_000;
const minutes = (n: number) => T0 + n * 60_000;
afterEach(() => sessionStorage.clear());

describe("the hand-off marker", () => {
  it("is read once, by the WebID it was written for", () => {
    markPodMade(made, sessionStorage, T0);
    expect(takePodMade(made.webId, sessionStorage, minutes(1))).toEqual(made);
    expect(takePodMade(made.webId, sessionStorage, minutes(1))).toBeNull();
  });

  it("another person's sign-in can neither see it nor use it up", () => {
    markPodMade(made, sessionStorage, T0);
    expect(takePodMade("https://someone.else/#me", sessionStorage, minutes(1))).toBeNull();
    expect(takePodMade(made.webId, sessionStorage, minutes(2))).toEqual(made);
  });

  it("holds the WebID, the pod address and the time, nothing else", () => {
    markPodMade({ ...made, email: "x@y.z", password: "secret" } as never, sessionStorage, T0);
    expect(JSON.parse(sessionStorage.getItem("mom-home:pod-made")!)).toEqual({ ...made, at: T0 });
  });

  it("expires, and an expired one is forgotten", () => {
    markPodMade(made, sessionStorage, T0);
    expect(takePodMade(made.webId, sessionStorage, minutes(MARKER_MINUTES + 1))).toBeNull();
    expect(sessionStorage.getItem("mom-home:pod-made")).toBeNull();
  });

  it("refuses a pod address that is not https, and damaged entries", () => {
    sessionStorage.setItem("mom-home:pod-made", JSON.stringify({ ...made, pod: "javascript:alert(1)", at: T0 }));
    expect(takePodMade(made.webId, sessionStorage, T0)).toBeNull();
    sessionStorage.setItem("mom-home:pod-made", "{not json");
    expect(takePodMade(made.webId, sessionStorage, T0)).toBeNull();
  });

  it("signed out, looking does not spend it", () => {
    markPodMade(made, sessionStorage, T0);
    expect(peekPodMade(sessionStorage, minutes(1))).toEqual(made);
    expect(peekPodMade(sessionStorage, minutes(2))).toEqual(made);
    clearPodMade(sessionStorage);
    expect(peekPodMade(sessionStorage, minutes(2))).toBeNull();
  });

  it("costs nothing when storage throws, even on first access", () => {
    const broken = { setItem() { throw new Error("blocked"); }, getItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } } as unknown as Storage;
    expect(() => markPodMade(made, broken)).not.toThrow();
    expect(takePodMade(made.webId, broken)).toBeNull();
    expect(peekPodMade(broken)).toBeNull();
    expect(() => clearPodMade(broken)).not.toThrow();
    // `globalThis.sessionStorage` itself throwing, as it does with blocked site data.
    const real = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage")!;
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new DOMException("denied", "SecurityError"); } });
    try {
      expect(() => markPodMade(made)).not.toThrow();
      expect(takePodMade(made.webId)).toBeNull();
      expect(peekPodMade()).toBeNull();
    } finally {
      Object.defineProperty(globalThis, "sessionStorage", real);
    }
  });
});
