import { spawnSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const maxBuffer = 32 * 1024 * 1024;

function command(executable, args, cwd, input) {
  return spawnSync(executable, args, {
    cwd, input, encoding: "utf8", maxBuffer, windowsHide: true,
    timeout: 60_000,
  });
}

function git(root, args) {
  const result = command("git", args, root);
  if (result.error || result.status !== 0) {
    // Git diagnostics can contain source lines or local configuration values.
    throw new Error(`Git command failed (${args[0]}); verify refs, repository and permissions.`);
  }
  return result.stdout;
}

function options(args) {
  const result = { staged: false, base: null, head: "HEAD" };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--staged") result.staged = true;
    else if (["--base", "--head"].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith("--")) {
      result[args[i].slice(2)] = args[++i];
    } else throw new Error("Usage: static-checks.mjs [--staged | --base <ref> [--head <ref>]]");
  }
  if ((result.staged && result.base) || (!result.base && result.head !== "HEAD")) {
    throw new Error("--head requires --base; --staged cannot be combined with --base.");
  }
  return result;
}

/** Finds literal module edges with TypeScript's parser, avoiding matches in comments and strings. */
export function frontendViolations(ts, file, content) {
  if (!/^frontend\/(components|features)\//.test(file)) return [];
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const results = [];
  function visit(node) {
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      specifier = node.moduleReference.expression;
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      specifier = node.argument.literal;
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      specifier = node.arguments[0];
    }
    if (specifier && (ts.isStringLiteral(specifier) || ts.isNoSubstitutionTemplateLiteral(specifier))) {
      const value = specifier.text;
      const target = value.startsWith("@/") ? path.posix.normalize(`frontend/${value.slice(2)}`) :
        value.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(file), value)) : "";
      const forbidden = file.startsWith("frontend/components/") ?
        /^frontend\/(features|app)(\/|$)/.test(target) : /^frontend\/app(\/|$)/.test(target);
      if (forbidden) results.push({
        rule: "A1", file, line: source.getLineAndCharacterOfPosition(specifier.getStart(source)).line + 1,
        target,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return results;
}

/** Checks a selected Git snapshot without checking it out or writing source files. */
export function runChecks(args = [], cwd = process.cwd()) {
  const config = options(args);
  const root = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  const resolve = (ref) => git(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).trim();
  const head = resolve(config.base ? config.head : "HEAD");
  const base = config.base ? git(root, ["merge-base", resolve(config.base), head]).trim() : head;
  const mode = config.base ? "range" : config.staged ? "staged" : "local";
  const diffArgs = mode === "range" ? [base, head] : mode === "staged" ? ["--cached", head] : [head];
  const split = (value) => value.split("\0").filter(Boolean);
  const changed = split(git(root, ["diff", "--name-only", "--no-renames", "-z", ...diffArgs, "--"]));
  const files = split(git(root, ["diff", "--name-only", "--no-renames", "--diff-filter=ACMRT", "-z", ...diffArgs, "--"]));
  const untracked = mode === "local" ? split(git(root, ["ls-files", "--others", "--exclude-standard", "-z"])) : [];
  const selected = [...new Set([...files, ...untracked])].sort();
  const results = [];
  const add = (check, status, detail = {}) => results.push({ check, status, ...detail });
  const trackedAtBase = new Set(split(git(root, ["ls-tree", "-r", "--name-only", "-z", base])));
  const contentAt = (file, old = false) => {
    if (old) return trackedAtBase.has(file) ? git(root, ["show", `${base}:${file}`]) : "";
    if (mode === "range") return git(root, ["show", `${head}:${file}`]);
    if (mode === "staged") return git(root, ["show", `:${file}`]);
    const target = path.resolve(root, file);
    if (lstatSync(target).isSymbolicLink()) throw new Error("Symlink content is not checked.");
    return readFileSync(target, "utf8");
  };

  for (const file of untracked) {
    // Restrict reads to source/document formats; local configuration is not scanned.
    if (!/\.(?:[cm]?[jt]sx?|go|json|md|ya?ml|css|html|cmd|ps1)$/.test(file)) continue;
    try {
      const locations = [];
      contentAt(file).split(/\r?\n/).forEach((line, index) => {
        if (/[\t ]+$/.test(line) || /^(?:<{7}|={7}|>{7})(?: |$)/.test(line)) {
          locations.push({ file, line: index + 1, message: "Trailing whitespace or conflict marker." });
        }
      });
      add("untracked-diff-check", locations.length ? "fail" : "pass", { file, locations });
    } catch { add("untracked-diff-check", "error", { file }); }
  }

  const whitespace = command("git", ["diff", "--check", ...diffArgs, "--"], root);
  if (whitespace.error || ![0, 2].includes(whitespace.status)) add("diff-check", "error");
  else {
    // Omit the following source-line excerpts, which might include secrets.
    const locations = whitespace.stdout.split(/\r?\n/).flatMap((line) => {
      if (line.startsWith("+")) return [];
      const match = /^(.*):(\d+): (.+)$/.exec(line);
      return match ? [{ file: match[1], line: Number(match[2]), message: match[3] }] : [];
    });
    add("diff-check", whitespace.status === 0 ? "pass" : "fail", { locations });
  }

  const sourceFiles = selected.filter((file) => /^frontend\/(components|features)\/.*\.[cm]?[jt]sx?$/.test(file));
  let ts;
  if (sourceFiles.length) {
    try { ts = createRequire(path.join(root, "frontend", "package.json"))("typescript"); }
    catch { add("frontend-architecture", "skipped", { reason: "TypeScript is not installed in frontend/." }); }
  } else add("frontend-architecture", "not-applicable");

  let jsonCount = 0;
  let goCount = 0;
  for (const file of selected) {
    const json = file.endsWith(".json");
    const go = file.endsWith(".go");
    const architecture = ts && sourceFiles.includes(file);
    if (!json && !go && !architecture) continue;
    let content;
    try { content = contentAt(file); }
    catch { add("snapshot-read", "error", { file }); continue; }
    if (json) {
      jsonCount++;
      try { JSON.parse(content.replace(/^\uFEFF/, "")); add("json", "pass", { file }); }
      catch { add("json", "fail", { file, reason: "Invalid JSON (source omitted)." }); }
    }
    if (go) {
      goCount++;
      const formatted = command("gofmt", ["-l"], root, content);
      if (formatted.error) add("gofmt", "skipped", { file, reason: "gofmt unavailable or timed out." });
      else add("gofmt", formatted.status === 0 && !formatted.stdout.trim() ? "pass" : "fail", { file });
    }
    if (architecture) {
      try {
        const old = new Set(frontendViolations(ts, file, contentAt(file, true)).map((item) => item.target));
        const introduced = frontendViolations(ts, file, content).filter((item) => !old.has(item.target));
        add("frontend-architecture", introduced.length ? "fail" : "pass", { file, locations: introduced });
      } catch { add("frontend-architecture", "error", { file, reason: "Cannot read baseline." }); }
    }
  }
  if (!jsonCount) add("json", "not-applicable");
  if (!goCount) add("gofmt", "not-applicable");
  const incomplete = results.some((item) => ["error", "skipped"].includes(item.status));
  const failed = results.some((item) => item.status === "fail");
  return {
    scope: { mode, base, head: mode === "range" ? head : mode === "staged" ? "index" : "working-tree",
      files: [...new Set([...changed, ...untracked])].sort(), noChanges: changed.length + untracked.length === 0 },
    note: "Only selected files are checked. Deleted files have no content checks. Tests, builds and API compatibility are not checked.",
    results,
    exitCode: incomplete ? 2 : failed ? 1 : 0,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = runChecks(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.exitCode;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: error.message, exitCode: 2 })}\n`);
    process.exitCode = 2;
  }
}
