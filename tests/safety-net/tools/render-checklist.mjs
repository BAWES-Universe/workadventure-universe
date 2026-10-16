// Renders checklist.json as a readable markdown page (the copy kept in the project files).
// Usage: node tools/render-checklist.mjs <out.md> [results/results.json[,more.json]]
// With a results file, each row also shows its last phone and desktop result.
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const [out, resultsFile] = process.argv.slice(2);
const { rows } = JSON.parse(fs.readFileSync(path.join(here, "../checklist.json"), "utf8"));
const specs = fs.readdirSync(path.join(here, "../specs")).filter((f) => f.endsWith(".spec.ts"));
const automated = new Set();
for (const f of specs) {
    for (const m of fs
        .readFileSync(path.join(here, "../specs", f), "utf8")
        .matchAll(/test\(\s*["'`]((?:[A-Z]{2}-\d{3}\s+)+)/g)) {
        for (const id of m[1].trim().split(/\s+/)) automated.add(id);
    }
}

const status = new Map();
if (resultsFile) {
    const walk = (suite) => {
        for (const s of suite.suites ?? []) walk(s);
        for (const spec of suite.specs ?? []) {
            for (const id of spec.title.match(/\b[A-Z]{2}-\d{3}\b/g) ?? []) {
                for (const t of spec.tests) {
                    if (t.status === "skipped") continue;
                    const k = `${id}|${t.projectName}`;
                    const ok = t.status !== "unexpected";
                    status.set(k, (status.get(k) ?? true) && ok);
                }
            }
        }
    };
    for (const file of resultsFile.split(","))
        for (const s of JSON.parse(fs.readFileSync(file, "utf8")).suites) walk(s);
}
const res = (id, p) => (status.has(`${id}|${p}`) ? (status.get(`${id}|${p}`) ? "pass" : "**FAIL**") : "–");
const how = (r) =>
    automated.has(r.id)
        ? "automatic"
        : r.runs === "yes"
        ? `by hand (${r.handReason ?? "not automated yet"})`
        : `by hand (${r.runs.replace("needs-", "needs ")})`;
const esc = (s) => s.replace(/\n/g, " ");

const lines = [
    "# Safety net checklist",
    "",
    "Every action a player can take in the game, and what should happen on the current dev build.",
    "Source of truth: `tests/safety-net/checklist.json` in the game repo. This page is generated from it; edit the JSON, not this page.",
    "",
    `${rows.length} rows. ${
        rows.filter((r) => automated.has(r.id)).length
    } run automatically as a phone (428x926, touch) and a desktop (1440x900); the rest are checked by hand.`,
    "Source column: `prod` = the live game does this today; `approved …` = a change Khalid approved, with where and when.",
    "Rows marked KNOWN GAP or KNOWN FAIL describe the approved behaviour that dev does not do yet; they fail until the owning thread's fix lands.",
    "",
];
for (const area of [...new Set(rows.map((r) => r.area))]) {
    const mine = rows.filter((r) => r.area === area);
    lines.push(`## ${area} (${mine.length})`, "");
    lines.push(
        resultsFile
            ? "| ID | Action | Expected | Source | Checked | Phone | Desktop |"
            : "| ID | Action | Expected | Source | Checked |"
    );
    lines.push(resultsFile ? "|---|---|---|---|---|---|---|" : "|---|---|---|---|---|");
    for (const r of mine) {
        const base = `| ${r.id} | ${esc(r.action)} | ${esc(r.expected)} | ${esc(r.source)} | ${how(r)} |`;
        lines.push(resultsFile ? `${base} ${res(r.id, "phone")} | ${res(r.id, "desktop")} |` : base);
    }
    lines.push("");
}
fs.writeFileSync(out, lines.join("\n"));
console.log(`wrote ${out}`);
