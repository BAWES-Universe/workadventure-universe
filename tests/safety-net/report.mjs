// Turns a Playwright run into the safety-net summary the Dev desk pastes at the top of a go-live note.
// Usage: node report.mjs [--build <commit>] [--out results/summary.md] [--results a.json,b.json] [--tier quick]
// Reads results/results.json (Playwright JSON reporter), or several result files from a run split in parts, and checklist.json.
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const arg = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
};
const build = arg("--build", process.env.SAFETY_NET_BUILD ?? "unknown build");
const out = arg("--out", path.join(here, "results/summary.md"));

const checklist = JSON.parse(fs.readFileSync(path.join(here, "checklist.json"), "utf8"));
const resultFiles = arg("--results", path.join(here, "results/results.json")).split(",");
const rows = new Map(checklist.rows.map((r) => [r.id, r]));
const ID = /\b[A-Z]{2}-\d{3}\b/g;

// Each test's last result wins: with several result files (a run in parts, or a rerun of tests fixed after a run),
// a later file replaces an earlier file's result for the same test.
const tests = new Map(); // `${project}|${file}|${title}` -> { spec, test }
function walk(suite) {
    for (const s of suite.suites ?? []) walk(s);
    for (const spec of suite.specs ?? []) {
        for (const t of spec.tests) {
            if (t.status !== "skipped") tests.set(`${t.projectName}|${spec.file}|${spec.title}`, { spec, t });
        }
    }
}
for (const file of resultFiles) for (const s of JSON.parse(fs.readFileSync(file, "utf8")).suites) walk(s);

// One check = one checklist row on one viewport. A row covered by several tests passes only if all pass.
const checks = new Map(); // `${id}|${project}` -> { status, failures: [] }
const unknownIds = new Set();
for (const { spec, t } of tests.values()) {
    const ids = [...new Set(spec.title.match(ID) ?? [])];
    const last = t.results[t.results.length - 1];
    const status = t.status === "expected" ? "pass" : t.status === "flaky" ? "flaky" : "fail";
    for (const id of ids) {
        if (!rows.has(id)) unknownIds.add(id);
        const key = `${id}|${t.projectName}`;
        const c = checks.get(key) ?? { id, project: t.projectName, status: "pass", failures: [] };
        if (status === "fail") {
            c.status = "fail";
            const shot = (last?.attachments ?? []).find((a) => a.name === "screenshot")?.path;
            const msg = (last?.errors?.[0]?.message ?? last?.error?.message ?? "")
                .replace(/\x1b\[[0-9;]*m/g, "")
                .split("\n")[0];
            c.failures.push({ title: spec.title, file: spec.file, line: spec.line, msg, shot });
        } else if (status === "flaky" && c.status === "pass") {
            c.status = "flaky";
        }
        checks.set(key, c);
    }
}

const all = [...checks.values()];
const passed = all.filter((c) => c.status !== "fail");
const failed = all.filter((c) => c.status === "fail" && !rows.get(c.id)?.knownGap);
const knownFailed = all.filter((c) => c.status === "fail" && rows.get(c.id)?.knownGap);
const flaky = all.filter((c) => c.status === "flaky");
const byProject = (p) => {
    const mine = all.filter((c) => c.project === p);
    return `${mine.filter((c) => c.status !== "fail").length}/${mine.length}`;
};
const covered = new Set(all.map((c) => c.id));
const notAutomated = checklist.rows.filter((r) => !covered.has(r.id));
const reasons = {};
for (const r of notAutomated) reasons[r.runs] = (reasons[r.runs] ?? 0) + 1;

const lines = [];
lines.push(
    `**${passed.length} of ${all.length} checks pass** on ${build} (phone ${byProject("phone")}, desktop ${byProject(
        "desktop"
    )}).`
);
lines.push("");
if (arg("--tier", "full") === "quick") {
    lines.push(
        `Quick run (tools/pick-tier.mjs): ${covered.size} of ${checklist.rows.length} checklist rows, the ones near the changed files plus the smoke set. ` +
            "The rest were not run on this build."
    );
} else {
    lines.push(
        `${covered.size} of ${checklist.rows.length} checklist rows run automatically. ` +
            `The other ${notAutomated.length} are checked by hand: ` +
            Object.entries(reasons)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => `${v} ${k === "yes" ? "not automated yet" : k}`)
                .join(", ") +
            "."
    );
}
if (failed.length || knownFailed.length) {
    lines.push("", `${failed.length} new failure(s), ${knownFailed.length} known gap(s) already with their owners.`);
}
const listFailures = (title, list) => {
    if (!list.length) return;
    lines.push("", title, "");
    for (const c of list) {
        const r = rows.get(c.id);
        lines.push(`- **${c.id}** (${c.project}) ${r ? r.action : ""}`);
        if (r) lines.push(`  - Expected: ${r.expected}`);
        for (const f of c.failures) {
            lines.push(`  - ${f.file}:${f.line} — ${f.msg}`);
            if (f.shot) lines.push(`  - Screenshot: ${f.shot}`);
        }
    }
};
listFailures("## New failures", failed);
listFailures("## Known gaps (approved behaviour not on this build yet)", knownFailed);
if (flaky.length) {
    lines.push("", "## Passed only on retry", "");
    for (const c of flaky) lines.push(`- ${c.id} (${c.project}) ${rows.get(c.id)?.action ?? ""}`);
}
if (unknownIds.size) lines.push("", `Tests name rows missing from checklist.json: ${[...unknownIds].join(", ")}`);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join("\n") + "\n");
console.log(lines.join("\n"));
process.exitCode = failed.length ? 1 : 0;
