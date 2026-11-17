import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { runChecks, frontendViolations } from "./static-checks.mjs";

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function write(root, file, value) {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, value);
}

function commit(root) {
  git(root, "add", ".");
  git(root, "-c", "user.name=Review Test", "-c", "user.email=review@example.invalid", "commit", "-qm", "fixture");
  return git(root, "rev-parse", "HEAD");
}

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "uptime-review-"));
  t.after(() => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith("uptime-review-"));
    rmSync(resolved, { recursive: true, force: true });
  });
  git(root, "init", "-q");
  git(root, "config", "core.autocrlf", "false");
  write(root, "data.json", '{"value":1}\n');
  commit(root);
  return root;
}

test("clean snapshot is explicit; local mode includes new files and reports invalid JSON without source", (t) => {
  const root = fixture(t);
  assert.equal(runChecks([], root).scope.noChanges, true);
  write(root, "new file.json", '{"secret":"do-not-print",broken}\n');
  const report = runChecks([], root);
  assert.equal(report.exitCode, 1);
  assert.ok(report.scope.files.includes("new file.json"));
  assert.ok(report.results.some((r) => r.check === "json" && r.status === "fail"));
  assert.ok(!JSON.stringify(report).includes("do-not-print"));
});

test("staged content is checked independently of unstaged and untracked changes", (t) => {
  const root = fixture(t);
  write(root, "data.json", '{"value":2}\n');
  git(root, "add", "data.json");
  write(root, "data.json", "invalid\n");
  write(root, "untracked.json", "invalid\n");
  const report = runChecks(["--staged"], root);
  assert.equal(report.exitCode, 0);
  assert.deepEqual(report.scope.files, ["data.json"]);
  assert.equal(runChecks([], root).exitCode, 1);
  assert.equal(readFileSync(path.join(root, "data.json"), "utf8"), "invalid\n");
});

test("range uses merge-base and committed head, without reading dirty working content", (t) => {
  const root = fixture(t);
  const base = git(root, "rev-parse", "HEAD");
  write(root, "data.json", '{"value":2}\n');
  const head = commit(root);
  write(root, "data.json", "invalid\n");
  const report = runChecks(["--base", base, "--head", head], root);
  assert.equal(report.exitCode, 0);
  assert.equal(report.scope.base, base);
  assert.equal(report.scope.head, head);
});

test("deletion is reported without trying to parse the deleted file", (t) => {
  const root = fixture(t);
  rmSync(path.join(root, "data.json"));
  const report = runChecks([], root);
  assert.deepEqual(report.scope.files, ["data.json"]);
  assert.equal(report.scope.noChanges, false);
  assert.equal(report.exitCode, 0);
});

test("whitespace and conflict diagnostics omit source excerpts", (t) => {
  const root = fixture(t);
  write(root, "note.md", "original\n");
  commit(root);
  write(root, "note.md", "file:123: do-not-print  \n");
  write(root, "data.json", '{"secret":"do-not-print"}  \n');
  write(root, "new.md", "<<<<<<< ours\ntext\n=======\n>>>>>>> theirs\n");
  const report = runChecks([], root);
  assert.equal(report.exitCode, 1);
  assert.ok(report.results.some((r) => r.check === "diff-check" && r.status === "fail"));
  assert.ok(report.results.some((r) => r.check === "untracked-diff-check" && r.status === "fail"));
  assert.ok(!JSON.stringify(report).includes("do-not-print"));
});

test("invalid ranges and incompatible flags fail instead of selecting another diff", (t) => {
  const root = fixture(t);
  assert.throws(() => runChecks(["--base", "missing-ref"], root), /Git command failed/);
  assert.throws(() => runChecks(["--head", "other"], root), /requires --base/);
  assert.throws(() => runChecks(["--staged", "--base", "HEAD"], root), /cannot be combined/);
});

test("gofmt checks stdin and leaves an unformatted source file unchanged", (t) => {
  if (spawnSync("gofmt", ["-h"], { windowsHide: true }).error) return t.skip("gofmt unavailable");
  const root = fixture(t);
  const content = "package fixture\nfunc Value() int {return 1}\n";
  write(root, "backend/value.go", content);
  const report = runChecks([], root);
  assert.ok(report.results.some((r) => r.check === "gofmt" && r.status === "fail"));
  assert.equal(readFileSync(path.join(root, "backend/value.go"), "utf8"), content);
  write(root, "backend/value.go", "package fixture\n\nfunc Value() int { return 1 }\n");
  assert.ok(runChecks([], root).results.some((r) => r.check === "gofmt" && r.status === "pass"));
});

test("architecture detects literal edges and ignores comments, ordinary strings and allowed directions", (t) => {
  let ts;
  try { ts = createRequire(path.resolve("frontend/package.json"))("typescript"); }
  catch { return t.skip("Install frontend dependencies to test the TypeScript AST checks."); }
  const content = `// import X from '@/features/auth/api';
const example = "import X from '@/app/page'";
import type { User } from '@/features/auth/api';
export { default } from '../../app/page';
const page = import('@/app/page');
const api = require('@/features/auth/api');
type Page = import('@/app/page').Page;
import Other = require('@/app/other');
`;
  const violations = frontendViolations(ts, "frontend/components/Avatar/Avatar.tsx", content);
  assert.equal(violations.length, 6);
  assert.equal(violations[0].line, 3);
  assert.ok(violations.every((v) => v.rule === "A1"));
  assert.equal(frontendViolations(ts, "frontend/features/profile/api.ts", "import { User } from '@/features/auth/api';").length, 0);
  assert.equal(frontendViolations(ts, "frontend/features/profile/api.ts", "export * from '../../app/page';").length, 1);
  assert.equal(frontendViolations(ts, "frontend/app/page.tsx", "import X from '@/features/auth/api';").length, 0);
});

test("missing TypeScript marks architecture checking incomplete", (t) => {
  const root = fixture(t);
  write(root, "frontend/components/Avatar/Avatar.tsx", "export default function Avatar() { return null; }\n");
  const report = runChecks([], root);
  assert.equal(report.exitCode, 2);
  assert.ok(report.results.some((r) => r.check === "frontend-architecture" && r.status === "skipped"));
});

test("architecture reports newly introduced edges, preserving existing baseline violations", (t) => {
  let compiler;
  try { compiler = createRequire(path.resolve("frontend/package.json")).resolve("typescript"); }
  catch { return t.skip("TypeScript unavailable"); }
  const root = fixture(t);
  write(root, ".gitignore", "node_modules/\n");
  write(root, "frontend/node_modules/typescript/package.json", '{"main":"index.cjs"}\n');
  write(root, "frontend/node_modules/typescript/index.cjs", `module.exports = require(${JSON.stringify(compiler)});\n`);
  const file = "frontend/components/Avatar/Avatar.tsx";
  const old = "import X from '@/features/auth/api';\n";
  write(root, file, old);
  commit(root);
  write(root, file, `${old}export const value = 1;\n`);
  assert.equal(runChecks([], root).exitCode, 0);
  write(root, file, `${old}export * from '../../app/page';\n`);
  const report = runChecks([], root);
  const result = report.results.find((r) => r.check === "frontend-architecture");
  assert.equal(report.exitCode, 1);
  assert.equal(result.locations.length, 1);
  assert.equal(result.locations[0].target, "frontend/app/page");
  assert.equal(result.locations[0].line, 2);
});
