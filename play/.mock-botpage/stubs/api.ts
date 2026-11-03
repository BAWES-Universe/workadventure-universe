import { readBotUsage } from "../../src/front/external-modules/bots/usageModel";
import { readPermissions } from "../../src/front/external-modules/bots/accessModel";
import { state } from "./state";

function days(range: string): string[] {
    const n = range === "today" ? 1 : range === "30d" ? 30 : 7;
    const out: string[] = [];
    const now = new Date("2026-10-28T12:00:00Z");
    for (let i = n - 1; i >= 0; i--) out.push(new Date(now.getTime() - i * 864e5).toISOString().slice(0, 10));
    return out;
}
function usage(range: string) {
    const d = days(range);
    const perDay = d.map((day, i) => ({ day, dm: (i * 7) % 11, nearby: (i * 5) % 6, notSplit: 0 }));
    const dm = perDay.reduce((a, x) => a + x.dm, 0);
    const nearby = perDay.reduce((a, x) => a + x.nearby, 0);
    return {
        range, timeZone: "Asia/Kuwait", days: d, hasUsage: true, viewerIsMaker: state.viewer === "sara",
        totals: { replies: dm + nearby, people: 4, tokens: 48200 },
        channels: { dm, nearby, notSplit: 0 }, perDay,
        people: [], guests: { count: 0, replies: 0, dm: 0, nearby: 0, notSplit: 0 },
        ranOn: [], keyProblem: null,
        limits: { universeAi: { signedIn: 30, guest: 10, guestPool: 200, windowHours: 5 }, botLimit: null, botLimitWindowHours: 24, ranOut: { universeAi: 0, botLimit: 0 }, askedMaker: 0 },
    };
}

const theirs = (id: string, name: string, owner: string, logo: string) => ({ id, name, ownerName: owner, mine: false, status: "working", ifDown: "universe-ai", logo, plainIcon: null });
const lent = (id: string, name: string, kindLabel: string, logo: string, model: string, models: string[]) => ({
    id, name, kind: logo, kindLabel, logo, plainIcon: null, group: "hosted", universeName: "BAWES Universe",
    status: "working", ifDown: "universe-ai", model, models: models.map((m) => ({ id: m, tools: true, vision: true })),
});
const myClaude = lent("key-khalid", "My Claude", "Claude", "anthropic", "claude-sonnet-5-5", ["claude-sonnet-5-5", "claude-haiku-5-5"]);
const sarasOwn = lent("key-sara", "My DeepSeek", "DeepSeek", "deepseek", "deepseek-chat", ["deepseek-chat", "deepseek-reasoner"]);
const keys = state.viewer === "khalid" ? [myClaude] : state.viewer === "sara" ? [sarasOwn] : [];
const mine = keys.find((k) => k.id === state.on);
const currentKey =
    state.on === "universe-ai" ? null
    : mine ? { id: mine.id, name: mine.name, ownerName: null, mine: true, status: "working", ifDown: "universe-ai", logo: mine.logo, plainIcon: null }
    : state.on === "key-sara" ? theirs("key-sara", "Sara's DeepSeek", "Sara", "deepseek")
    : theirs("key-khalid", "Khalid's Claude", "Khalid", "anthropic");
const options = {
    current: state.on,
    currentModel: state.on === "key-khalid" ? "claude-sonnet-5-5" : state.on === "key-sara" ? "deepseek-chat" : null,
    universeAi: { available: true },
    maker: { id: "sara", name: "Sara" },
    viewerIsMaker: state.viewer === "sara",
    keys,
    currentKey,
    providers: null,
};
const T = new URLSearchParams(location.search).get("t") ?? "linear";
const tool = (name: string, title: string, description: string, kind: string, from = "read", reviewedBy: string | null = "Sara", changedSince?: string) =>
    ({ name, title, description, kind, from, reviewedBy: reviewedBy ?? undefined, changedSince });
const openTool = new URLSearchParams(location.search).get("tool") ?? undefined;
const legacy = T === "legacy";
const by = legacy ? null : "Sara";
const linearTools = [
    tool("list_issues", "List issues", "List issues in the workspace, filtered by team, state or person", "look", "server", by),
    tool("get_issue", "Get issue", "Get one issue with its description, comments and links", "look", "server", by),
    tool("list_projects", "List projects", "List projects in the workspace", "look", "server", by),
    tool("search_documentation", "Search documentation", "Search Linear's own help pages", "look", "read", by),
    tool("save_issue", "Save issue", "Create a new issue, or update one when an id is given", "change", "server", by),
    T === "changed"
        ? tool("save_comment", "Save comment", "Add a comment to an issue, edit one, or post it to Slack", "change", "server", null, "Sara")
        : tool("save_comment", "Save comment", "Add a comment to an issue, or edit one", "change", "server", by),
    tool("create_issue_label", "Create issue label", "Create a new issue label", "change", legacy ? "read" : "you", by),
    tool("delete_comment", "Delete comment", "Delete a comment from an issue", "send", "server", by),
    tool("delete_attachment", "Delete attachment", "Remove an attachment from an issue", "send", "read", by),
];
const linear = {
    id: "s1", name: "Linear", serverUrl: "https://mcp.linear.app/mcp", authType: "oauth", oauthConnected: true, enabled: true,
    lastTestedAt: "2026-11-03T07:40:00Z", lastTestResult: { success: true, toolCount: 9, toolNames: [], error: null }, createdAt: "2026-10-12T09:00:00Z",
    toolKinds: { openTool, legacy, runs: { look: "run", make: "run", change: "ask", send: "ask" }, tools: linearTools },
};
const imagine = {
    id: "s2", name: "Imagine", serverUrl: "https://imagine.example/mcp", authType: "bearer", enabled: true,
    lastTestedAt: "2026-11-03T18:00:00Z", lastTestResult: { success: true, toolCount: 3, toolNames: [], error: null }, createdAt: "2026-11-03T18:00:00Z",
    toolKinds: { openTool, runs: { look: "run", make: "run", change: "ask", send: "ask" }, tools: [
        tool("generate_image", "Generate image", "Make an image from a prompt", "make", "read", null),
        tool("generate_music", "Generate music", "Make a song from a prompt and a style", "make", "read", null),
        tool("get_generation", "Get generation", "Check on an image or song still being made", "look", "server", null),
    ] },
};
const tavily = {
    id: "s3", name: "Tavily", serverUrl: "https://mcp.tavily.com/mcp", authType: "api-key", enabled: true,
    lastTestedAt: "2026-10-29T18:00:00Z", lastTestResult: { success: true, toolCount: 2, toolNames: [], error: null }, createdAt: "2026-10-20T09:00:00Z",
    toolKinds: { openTool, runs: { look: "run", make: "run", change: "ask", send: "ask" }, tools: [
        tool("tavily_search", "Search", "Search the web", "look", "server"), tool("tavily_extract", "Extract", "Read the text of web pages", "look", "server")] },
};
const servers = T === "imagine" ? [imagine, linear, tavily] : [linear, imagine, tavily];
const call = null as string | null;
const role = (id: string, key: string, name: string, color: string, builtIn: boolean, d: Record<string, boolean>) => ({ id, key, name, color, builtIn, defaults: d });
const all = { chat: true, dm: true, summon: true, manage: true, change: true, send: true };
const roles = [
    role("r-admin", "admin", "Admin", "#F87171", true, all),
    role("r-eng", "engineering", "Engineering", "#34D399", false, { chat: false, dm: false, summon: false, manage: false, change: true, send: false }),
    role("r-editor", "editor", "Editor", "#60A5FA", true, { chat: false, dm: false, summon: false, manage: true, change: true, send: true }),
    role("r-member", "member", "Member", "#A78BFA", true, { chat: false, dm: false, summon: false, manage: false, change: true, send: false }),
    role("r-everyone", "everyone", "Everyone", "#A3A3B5", true, { chat: true, dm: true, summon: true, manage: false, change: false, send: false }),
];
const rule = (id: string, r: (typeof roles)[number], v: Record<string, string>) => ({ id, roleId: r.id, userId: null, role: { key: r.key, name: r.name, color: r.color }, person: null, ...v });
const permissions = readPermissions({
    privateBot: false, refusalReply: null, dailyReplyCap: null, roles,
    rules: [
        ...(call === "2b"
            ? [rule("x3", roles[4], { change: "yes", send: "yes" })]
            : [rule("x1", roles[1], { send: "yes" }), rule("x2", roles[3], { change: "no" })]),
    ],
});
const base: Record<string, unknown> = {
    onInitialize: (cb?: () => void) => { cb?.(); return () => {}; },
    isInitialized: () => true,
    getBotUsage: (_id: string, range: string) => Promise.resolve(readBotUsage(usage(range))),
    getBotAiOptions: () => Promise.resolve(options),
    getMyAiKeys: () => Promise.resolve(keys.map((k) => ({ id: k.id, name: k.name }))),
    getAvailableAIProviders: () => Promise.resolve([]),
    getBotPermissions: () => Promise.resolve(permissions),
    getBotTelemetry: () => Promise.resolve({ on: true, universeHides: false }),
    getBotMcpServers: () => Promise.resolve(servers),
    saveBotPermissions: () => Promise.resolve(null),
    saveBotTelemetry: () => Promise.resolve(null),
    updateBot: (id: string, data: object) => Promise.resolve({ id, ...data }),
    updateRunningBot: () => Promise.resolve(null),
    spawnBot: () => Promise.resolve(null),
    despawnBot: () => Promise.resolve(null),
};
export const botApiService = new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : () => Promise.resolve(null)) }) as never;
