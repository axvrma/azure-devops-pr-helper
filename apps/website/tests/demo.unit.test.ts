import { describe, expect, it } from "vitest";
import {
  branches,
  branchStatus,
  relationships,
  scenarios,
} from "../src/data/demoGraph";
import { productionUrl } from "../scripts/seo";
describe("sample graph integrity and evidence semantics", () => {
  it.each(scenarios)(
    "$label is a connected DAG with valid, unique relationships",
    ({ id }) => {
      const edges = relationships(id);
      expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
      const visiting = new Set<string>();
      const visited = new Set<string>();
      function visit(node: string) {
        expect(visiting.has(node)).toBe(false);
        if (visited.has(node)) return;
        visiting.add(node);
        edges.filter((e) => e.source === node).forEach((e) => visit(e.target));
        visiting.delete(node);
        visited.add(node);
      }
      branches.forEach((b) => visit(b.id));
      edges.forEach((e) => {
        expect(branches.some((b) => b.id === e.source)).toBe(true);
        expect(branches.some((b) => b.id === e.target)).toBe(true);
        expect(e.source).not.toBe(e.target);
        expect(e.next.length).toBeGreaterThan(10);
      });
      expect(new Set(edges.flatMap((e) => [e.source, e.target])).size).toBe(
        branches.length,
      );
    },
  );
  it("never presents missing simulation as a verified conflict or clean result", () => {
    const edges = relationships("conflict");
    expect(
      edges.find((e) => e.status === "conflict")?.conflictPath,
    ).toBeTruthy();
    expect(edges.find((e) => e.status === "unknown")?.evidence).toContain(
      "inconclusive",
    );
    edges
      .filter((e) => e.status === "action")
      .forEach((e) => expect(e.evidence).toContain("not simulated"));
    expect(branchStatus("checkout", edges)).toBe("conflict");
  });
  it("invalidates downstream evidence on release drift", () => {
    const edges = relationships("drift");
    expect(edges.find((e) => e.id === "main-r21")?.status).toBe("synced");
    expect(edges.filter((e) => e.status === "drifted")).toHaveLength(5);
    expect(branchStatus("checkout", edges)).toBe("drifted");
  });
  it("healthy flow has verified ancestry and no outstanding commits", () => {
    relationships("healthy").forEach((e) => {
      expect(e.status).toBe("synced");
      expect(e.commits).toBe(0);
      expect(e.pr).toBeUndefined();
    });
  });
});
describe("production origin configuration", () => {
  it("leaves unknown production URLs unset", () => {
    expect(productionUrl("")).toBeUndefined();
    expect(productionUrl()).toBeUndefined();
  });
  it("normalizes a configured HTTPS origin", () => {
    expect(productionUrl(" https://prism-test.netlify.app/ ")).toBe(
      "https://prism-test.netlify.app",
    );
  });
  it.each([
    "http://example.com",
    "https://example.com/path",
    "https://name:secret@example.com",
    "https://example.com/?x=y",
    "https://example.com/#x",
    "bad url",
  ])("rejects invalid canonical configuration: %s", (value) =>
    expect(() => productionUrl(value)).toThrow(),
  );
});
