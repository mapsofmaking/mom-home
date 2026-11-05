import { Parser, Store, Writer, type Quad, type Term } from "n3";

export const URL_ = "https://weld-done.pod.example/space.ttl";

/**
 * A pod that holds one Turtle file and applies N3 Patches as CSS does: the ETag must match (412); the
 * `solid:where` must match exactly once, its variables then bound in deletes and inserts; every delete must be
 * in the file (409). Otherwise nothing changes.
 */
export function pod(text: string) {
  let store = new Store(new Parser({ baseIRI: URL_ }).parse(text));
  let version = 1;
  const calls: { method: string; body?: string; ifMatch?: string }[] = [];
  const turtle = () => new Writer({ format: "Turtle" }).quadsToString(store.getQuads(null, null, null, null));
  const fetchImpl = async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ method, body: init?.body as string | undefined, ifMatch: headers["If-Match"] });
    if (method === "GET") return new Response(turtle(), { status: 200, headers: { ETag: `"v${version}"` } });
    if (headers["If-Match"] && headers["If-Match"] !== `"v${version}"`) return new Response("", { status: 412 });
    const quads: Quad[] = new Parser({ format: "text/n3", baseIRI: URL_ }).parse(init!.body as string);
    const formula = (p: string) => quads.find((q) => q.predicate.value === `http://www.w3.org/ns/solid/terms#${p}`)?.object;
    const inGraph = (g: Quad["object"] | undefined) => (g ? quads.filter((q) => q.graph.equals(g)) : []);
    const where = inGraph(formula("where"));
    // Every way the where's patterns match the file, variables bound.
    type Binding = Map<string, Term>;
    const term = (t: Term, b: Binding) => (t.termType === "Variable" ? b.get(t.value) ?? null : t);
    const solve = (i: number, b: Binding): Binding[] => {
      if (i === where.length) return [b];
      const q = where[i];
      return store.getQuads(term(q.subject, b), term(q.predicate, b), term(q.object, b), null).flatMap((m) => {
        const next = new Map(b);
        for (const [pat, got] of [[q.subject, m.subject], [q.object, m.object]] as const) {
          if (pat.termType === "Variable") next.set(pat.value, got);
        }
        return solve(i + 1, next);
      });
    };
    const solutions = solve(0, new Map());
    if (where.length && solutions.length !== 1) return new Response("", { status: 409 });
    const b = solutions[0] ?? new Map();
    const bind = (q: Quad) => [term(q.subject, b)!, q.predicate, term(q.object, b)!] as const;
    const deletes = inGraph(formula("deletes")).map(bind);
    const inserts = inGraph(formula("inserts")).map(bind);
    if (deletes.some(([s, p, o]) => store.getQuads(s, p, o, null).length === 0)) return new Response("", { status: 409 });
    const next = new Store(store.getQuads(null, null, null, null));
    deletes.forEach(([s, p, o]) => next.removeQuads(store.getQuads(s, p, o, null)));
    inserts.forEach(([s, p, o]) => next.addQuad(s as never, p as never, o as never));
    store = next;
    version++;
    return new Response(null, { status: 205 });
  };
  return { fetchImpl, calls, edit: (t: string) => { store = new Store(new Parser({ baseIRI: URL_ }).parse(t)); version++; }, text: turtle };
}
