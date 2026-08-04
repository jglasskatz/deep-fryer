import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PrinciplePackSchema } from "@keel_flow/schema";
import { researchPack, researchPrinciples } from "./index.js";

const emptyArchitecture = {
  schemaVersion: 1,
  layers: [],
  nodes: [],
  connections: [],
  contexts: [],
  // Cast: the pack's checks never read the map, and schema versions move.
} as never;

const diffOf = (files: { path: string; status: "added" | "modified" | "removed" }[]) =>
  ({ files }) as never;

describe("researchPack", () => {
  it("validates against PrinciplePackSchema", () => {
    expect(PrinciplePackSchema.safeParse(researchPack).success).toBe(true);
  });

  it("exports the same principles array on the pack", () => {
    expect(researchPack.principles).toBe(researchPrinciples);
  });

  it("has unique kebab-case ids", () => {
    const ids = researchPrinciples.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe("approval-binds-to-content check", () => {
  const principle = researchPrinciples.find((p) => p.id === "approval-binds-to-content")!;

  const run = (files: Parameters<typeof diffOf>[0], cwd: string) =>
    principle.check!({ diff: diffOf(files), architecture: emptyArchitecture, cwd });

  it("flags findings changes with no approval update", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pack-research-"));
    mkdirSync(join(cwd, "research", "findings"), { recursive: true });
    writeFileSync(join(cwd, "research", "findings", "housing.json"), "{}");

    const violations = run(
      [{ path: "research/findings/housing.json", status: "modified" }],
      cwd,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.severity).toBe("warning");
  });

  it("passes when an approval record changes alongside findings", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pack-research-"));
    mkdirSync(join(cwd, "research", "findings"), { recursive: true });
    writeFileSync(join(cwd, "research", "findings", "housing.json"), "{}");

    const violations = run(
      [
        { path: "research/findings/housing.json", status: "modified" },
        { path: "research/approvals/run-1.json", status: "added" },
      ],
      cwd,
    );
    expect(violations).toHaveLength(0);
  });

  it("ignores non-findings and removed files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pack-research-"));
    const violations = run(
      [
        { path: "src/app.ts", status: "modified" },
        { path: "research/findings/old.json", status: "removed" },
      ],
      cwd,
    );
    expect(violations).toHaveLength(0);
  });
});
