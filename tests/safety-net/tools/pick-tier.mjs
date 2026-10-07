// Decides how much of the safety net a candidate dev build needs, from the files it changes. No model, no network:
// plain git and the checklist. Prints the tier, why, and the Playwright command to run.
//
// Usage: node tools/pick-tier.mjs --base <rev> [--head <rev>] [--game-dir <checkout>]
//          [--ci-green] [--owner-checked] [--daily] [--prs <n>] [--json]
//   --base/--head     the build on dev now, and the candidate (head defaults to HEAD)
//   --ci-green        the candidate's own CI is green
//   --owner-checked   the owning thread ran its phone and desktop check on the candidate
//   --daily           the once-a-day run on the dev head: always full
//   --prs <n>         how many PRs the switch bundles (default: merge commits on the first-parent line, at least 1)
//
// Tiers:
//   skip   no game file changed, or a tiny look-only change that no checklist row names (needs --ci-green and --owner-checked)
//   quick  the rows that name a changed file, plus the smoke set (smoke.json), about 20-30 minutes
//   full   several PRs, shared code, a very wide change, or --daily: the whole suite, about 3 hours
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const arg = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(name);

const base = arg("--base");
if (!base) {
    console.error(
        "Usage: node tools/pick-tier.mjs --base <rev> [--head <rev>] [--game-dir <dir>] [--ci-green] [--owner-checked] [--daily] [--prs <n>] [--json]"
    );
    process.exit(2);
}
const head = arg("--head", "HEAD");
const gameDir = arg("--game-dir", process.env.GAME_DIR ?? path.join(here, "../../.."));
const git = (...a) =>
    execFileSync("git", ["-C", gameDir, ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();

const { rows } = JSON.parse(fs.readFileSync(path.join(here, "../checklist.json"), "utf8"));
const smoke = JSON.parse(fs.readFileSync(path.join(here, "../smoke.json"), "utf8")).rows;

// Rows that have a test, and how many tests each id has (a test runs once per viewport).
const specsDir = path.join(here, "../specs");
const automated = new Map();
for (const f of fs.readdirSync(specsDir).filter((f) => f.endsWith(".spec.ts"))) {
    for (const m of fs
        .readFileSync(path.join(specsDir, f), "utf8")
        .matchAll(/test\(\s*["'`]((?:[A-Z]{2}-\d{3}\s+)+)/g)) {
        for (const id of m[1].trim().split(/\s+/)) automated.set(id, (automated.get(id) ?? 0) + 1);
    }
}

const changed = git("diff", "--name-only", `${base}..${head}`).split("\n").filter(Boolean);
const lines = git("diff", "--numstat", `${base}..${head}`)
    .split("\n")
    .filter(Boolean)
    .reduce((n, l) => n + (Number(l.split("\t")[0]) || 0) + (Number(l.split("\t")[1]) || 0), 0);
const merges = git("log", "--first-parent", "--merges", "--oneline", `${base}..${head}`)
    .split("\n")
    .filter(Boolean).length;
const prs = Number(arg("--prs", Math.max(1, merges)));

// What each changed file is.
const isIgnored = (f) =>
    /\.(md|txt)$/i.test(f) ||
    /^(docs|contrib|benchmark|\.github|\.claude|\.husky|tests)\//.test(f) ||
    /\.(test|spec)\.(ts|js)$/.test(f);
const isShared = (f) =>
    /^(back|libs|messages|map-storage|uploader|play\/src\/pusher)\//.test(f) ||
    /(^|\/)(package(-lock)?\.json|Dockerfile[^/]*|docker-compose[^/]*|vite\.config[^/]*|tsconfig[^/]*\.json)$/.test(
        f
    ) ||
    /^play\/src\/(common|i18n\/i18n-[a-z]+\.ts)/.test(f);
const isLookOnly = (f) => /\.(svelte|scss|css)$/.test(f) || /^play\/src\/i18n\/en-US\//.test(f);

const gameFiles = changed.filter((f) => !isIgnored(f));
const sharedFiles = gameFiles.filter(isShared);

// Rows that name a changed file (in their hooks, expected text or action).
const NAME = /([A-Za-z0-9_]+\.(?:svelte|ts|scss|css))/g;
const rowFiles = new Map(
    rows.map((r) => [r.id, new Set([...`${r.hooks ?? ""} ${r.expected} ${r.action}`.matchAll(NAME)].map((m) => m[1]))])
);
const named = new Map(); // row id -> changed files that name it
for (const f of gameFiles) {
    const b = path.basename(f);
    for (const [id, names] of rowFiles) if (names.has(b)) named.set(id, [...(named.get(id) ?? []), f]);
}
// A file no row names still belongs to an area by where it lives: take that area's rows for the quick run.
const AREA_BY_PATH = [
    [/Broadcast/i, "BC"],
    [/MapEditor|Explorer|LookAround|EditMode|ExploreTheRoom/i, "ME"],
    [/\/Chat\/|Matrix/i, "CH"],
    [/Video|ActionBar|MediaSettings|Express|Follow|Bubble|Megaphone|Camera|Mic/i, "AV"],
    [/CoWebsite|Script|Iframe|Orbit/i, "OR"],
    [/Menu|Settings|Login|Woka|Profile|Status|EnableCamera|Reconnect|Notification/i, "JN"],
];
const unnamed = gameFiles.filter((f) => ![...named.values()].some((fs_) => fs_.includes(f)));
const fallbackAreas = new Set();
const unmapped = [];
for (const f of unnamed) {
    const hit = AREA_BY_PATH.find(([re]) => re.test(f));
    if (hit) fallbackAreas.add(hit[1]);
    else unmapped.push(f);
}
// An area that already has rows naming a changed file keeps just those; the whole area is added only when no row names anything in it.
const namedAreas = new Set([...named.keys()].map((id) => id.slice(0, 2)));
const fallbackRows = rows
    .filter((r) => fallbackAreas.has(r.id.slice(0, 2)) && !namedAreas.has(r.id.slice(0, 2)))
    .map((r) => r.id);

// The decision.
let tier;
let why;
if (flag("--daily")) {
    tier = "full";
    why = "the once-a-day run on the dev head";
} else if (prs >= 2) {
    tier = "full";
    why = `${prs} PRs go out together`;
} else if (sharedFiles.length > 0) {
    tier = "full";
    why = `shared code changed (${sharedFiles.slice(0, 3).join(", ")}${
        sharedFiles.length > 3 ? ", ..." : ""
    }), so any area can be affected`;
} else if (gameFiles.length > 30 || lines > 1500) {
    tier = "full";
    why = `a wide change (${gameFiles.length} files, ${lines} lines)`;
} else if (named.size > 150) {
    tier = "full";
    why = `${named.size} checklist rows name the changed files`;
} else if (gameFiles.length === 0) {
    tier = "skip";
    why = "no game file changed (docs, tests, CI or other files only)";
} else if (named.size === 0 && gameFiles.length <= 3 && lines <= 80 && gameFiles.every(isLookOnly)) {
    if (flag("--ci-green") && flag("--owner-checked")) {
        tier = "skip";
        why = `a small look-only change (${gameFiles.length} file(s), ${lines} lines) that no checklist row names; CI is green and the owning thread checked it on phone and desktop`;
    } else {
        tier = "quick";
        const missing = ["--ci-green", "--owner-checked"].filter((f) => !flag(f)).join(" and ");
        why = `a small look-only change that no row names would be skipped, but ${missing} not given`;
    }
} else {
    tier = "quick";
    why = `${gameFiles.length} game file(s), ${lines} lines: the rows near them plus the smoke set`;
    if (unmapped.length)
        why += `; no row or area known for ${unmapped.join(", ")}, so only the smoke set covers ${
            unmapped.length === 1 ? "it" : "them"
        }`;
}

const rowIds = new Set(
    tier === "quick" ? [...named.keys(), ...fallbackRows, ...smoke] : tier === "full" ? rows.map((r) => r.id) : []
);
const runnable = [...rowIds].filter((id) => automated.has(id));
const checks = runnable.reduce((n, id) => n + automated.get(id), 0) * 2;
const grep = tier === "quick" ? `\\b(${runnable.join("|")})\\b` : "";
const minutes = tier === "full" ? 190 : tier === "quick" ? Math.max(5, Math.round(checks * 0.23)) : 0;
const out = {
    tier,
    why,
    base,
    head,
    prs,
    changedFiles: changed.length,
    gameFiles: gameFiles.length,
    lines,
    rows: [...rowIds].length,
    runnableRows: runnable.length,
    approxChecks: tier === "full" ? "all" : checks,
    approxMinutes: minutes,
    named: Object.fromEntries([...named].map(([id, fs_]) => [id, [...new Set(fs_)].map((f) => path.basename(f))])),
    areaFallback: [...fallbackAreas],
    unmapped,
    grep,
};

if (flag("--json")) {
    console.log(JSON.stringify(out, null, 2));
} else {
    console.log(`tier: ${tier}`);
    console.log(`why: ${why}`);
    console.log(
        `range: ${base}..${head}, ${changed.length} files (${gameFiles.length} game), ${lines} lines, ${prs} PR(s)`
    );
    if (tier === "quick") {
        console.log(
            `rows: ${[...rowIds].length} (${named.size} name a changed file, ${fallbackRows.length} from the area, ${
                smoke.length
            } smoke), ${runnable.length} run automatically, about ${checks} checks, about ${minutes} min`
        );
        console.log(`run:  SAFETY_NET_WORKERS=2 npx playwright test --grep '${grep}'`);
        console.log(`then: node report.mjs --build <commit> --tier quick`);
    } else if (tier === "full") {
        console.log(`run:  SAFETY_NET_WORKERS=2 npx playwright test    (about 3 hours)`);
        console.log(`then: node report.mjs --build <commit>`);
    } else {
        console.log('run:  nothing. Put "safety net: skipped (<why>)" at the top of the go-live note.');
    }
}
