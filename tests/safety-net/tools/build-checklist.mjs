// Builds checklist.json from the area inventories (markdown tables with the columns
// ID | Area | Action | Expected | Source | Runs locally? | Hooks). Usage: node tools/build-checklist.mjs <dir with AREA.md files>
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const AREAS = {
    JN: "Join, profile and settings",
    AV: "Bar, camera, calls and moving",
    CH: "Chat",
    ME: "Map editor and Look around",
    BC: "Broadcasting",
    OR: "Orbit and map scripts",
};

function cells(line) {
    // Split on pipes that are not escaped (\|) and not inside backticks.
    const out = [];
    let cur = "",
        tick = false;
    for (let i = 1; i < line.length; i++) {
        const c = line[i];
        if (c === "`") tick = !tick;
        if (c === "|" && !tick && line[i - 1] !== "\\") {
            out.push(cur.trim());
            cur = "";
            continue;
        }
        cur += c;
    }
    return out;
}

function runs(raw) {
    const v = raw.toLowerCase();
    if (v.startsWith("yes")) return "yes";
    const m = v.match(/needs-[a-z]+/);
    return m ? m[0] : "unknown";
}

const rows = [];
for (const prefix of Object.keys(AREAS)) {
    const file = path.join(dir, `${prefix}.md`);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (!new RegExp(`^\\| ${prefix}-\\d{3} `).test(line)) continue;
        const c = cells(line);
        if (c.length < 7) throw new Error(`bad row in ${prefix}.md: ${line.slice(0, 80)}`);
        const [id, topic, action, expected, source, runsRaw, hooks] = c;
        rows.push({
            id,
            area: AREAS[prefix],
            topic,
            action,
            expected,
            source,
            runs: runs(runsRaw),
            runsNote: runsRaw,
            knownGap: /KNOWN (GAP|FAIL)/.test(expected),
            hooks,
        });
    }
}
const ids = new Set();
for (const r of rows) {
    if (ids.has(r.id)) throw new Error(`duplicate id ${r.id}`);
    ids.add(r.id);
}
fs.writeFileSync(
    path.join(path.dirname(new URL(import.meta.url).pathname), "../checklist.json"),
    JSON.stringify({ rows }, null, 1) + "\n"
);
console.log(
    `${rows.length} rows`,
    Object.fromEntries(Object.keys(AREAS).map((p) => [p, rows.filter((r) => r.id.startsWith(p)).length]))
);
