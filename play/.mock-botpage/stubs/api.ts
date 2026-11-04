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

// Real-scale data (mock 1 redo): Linear's and Notion's own tools, five servers, 60+ tools
const L = (name: string, title: string, description: string, kind: string, from = "server") => tool(name, title, description, kind, from, "Sara");
const bigLinear = [
    L("list_issues", "List issues", "List issues in the workspace, filtered by team, state or person", "look"),
    L("get_issue", "Get issue", "Get one issue with its description, comments and links", "look"),
    L("list_comments", "List comments", "List the comments on an issue", "look"),
    L("list_projects", "List projects", "List projects in the workspace", "look"),
    L("get_project", "Get project", "Get one project with its milestones and progress", "look"),
    L("list_teams", "List teams", "List the teams in the workspace", "look"),
    L("get_team", "Get team", "Get one team and its settings", "look"),
    L("list_users", "List users", "List the people in the workspace", "look"),
    L("get_user", "Get user", "Get one person's profile", "look"),
    L("list_issue_labels", "List issue labels", "List the labels a team uses", "look"),
    L("list_issue_statuses", "List issue statuses", "List the states an issue can be in", "look"),
    L("get_issue_status", "Get issue status", "Get one issue state", "look"),
    L("list_cycles", "List cycles", "List a team's cycles", "look"),
    L("list_documents", "List documents", "List documents in the workspace", "look"),
    L("get_document", "Get document", "Get one document's text", "look"),
    L("list_milestones", "List milestones", "List a project's milestones", "look"),
    L("get_milestone", "Get milestone", "Get one milestone", "look"),
    L("list_initiatives", "List initiatives", "List the workspace's initiatives", "look"),
    L("get_attachment", "Get attachment", "Get one attachment on an issue", "look"),
    L("extract_images", "Extract images", "Get the images inside an issue or comment", "look", "read"),
    L("search_documentation", "Search documentation", "Search Linear's own help pages", "look", "read"),
    L("save_issue", "Save issue", "Create a new issue, or update one when an id is given", "change"),
    L("save_comment", "Save comment", "Add a comment to an issue, or edit one", "change"),
    L("save_project", "Save project", "Create or update a project", "change"),
    L("save_document", "Save document", "Create or update a document", "change"),
    L("save_milestone", "Save milestone", "Create or update a milestone", "change"),
    L("save_initiative", "Save initiative", "Create or update an initiative", "change"),
    { ...L("create_issue_label", "Create issue label", "Create a new issue label", "change", "you") },
    L("create_attachment", "Create attachment", "Add a link or file to an issue", "change"),
    L("delete_comment", "Delete comment", "Delete a comment from an issue", "send"),
    L("delete_attachment", "Delete attachment", "Remove an attachment from an issue", "send", "read"),
    L("delete_status_update", "Delete status update", "Delete a project status update", "send"),
    L("delete_customer", "Delete customer", "Delete a customer record", "send"),
    L("delete_customer_need", "Delete customer need", "Delete a customer request", "send"),
];
const notionTools = [
    L("notion-search", "Search", "Search pages and databases in the workspace", "look"),
    L("notion-fetch", "Fetch", "Read a page or database", "look"),
    L("notion-get-comments", "Get comments", "Read the comments on a page", "look"),
    L("notion-get-users", "Get users", "List the people in the workspace", "look"),
    L("notion-get-teams", "Get teams", "List the teamspaces", "look"),
    L("notion-query-data-sources", "Query data sources", "Find rows in a database", "look"),
    L("notion-list-recent-pages", "List recent pages", "List pages opened lately", "look"),
    L("notion-create-pages", "Create pages", "Make new pages", "change"),
    T === "changed" ? tool("notion-update-page", "Update page", "Change a page's text, or publish it to the web", "change", "server", null, "Sara") : L("notion-update-page", "Update page", "Change a page's text or properties", "change"),
    L("notion-move-pages", "Move pages", "Move pages to another parent", "change"),
    L("notion-duplicate-page", "Duplicate page", "Copy a page", "change"),
    L("notion-create-database", "Create database", "Make a new database", "change"),
    L("notion-create-comment", "Create comment", "Add a comment to a page", "change"),
    L("notion-update-view", "Update view", "Change how a database view looks", "change"),
    L("notion-delete-pages", "Delete pages", "Move pages to the trash", "send"),
    L("notion-delete-comment", "Delete comment", "Delete a comment", "send"),
];
const S2 = (name: string, title: string, description: string, kind: string) => tool(name, title, description, kind, "read", null);
const sentryTools = [
    S2("search_issues", "Search issues", "Find error groups by text or status", "look"),
    S2("search_errors", "Search errors", "Find single error events", "look"),
    S2("get_issue_details", "Get issue details", "Read one error group with its stack trace", "look"),
    S2("search_traces", "Search traces", "Find slow requests", "look"),
    S2("search_logs", "Search logs", "Find log lines", "look"),
    S2("find_projects", "Find projects", "List the projects in the organization", "look"),
    S2("analyze_issue_with_seer", "Analyze issue with Seer", "Ask Sentry's AI for a likely cause", "look"),
    S2("update_issue", "Update issue", "Resolve, ignore or assign an error group", "change"),
];
const srv = (id: string, name: string, url: string, tools: unknown[], extra: Record<string, unknown> = {}) => ({
    id, name, serverUrl: url, authType: "oauth", oauthConnected: true, enabled: true, lastTestedAt: "2026-11-03T07:40:00Z",
    lastTestResult: { success: true, toolCount: tools.length, toolNames: [], error: null }, createdAt: "2026-10-12T09:00:00Z",
    toolKinds: { openTool, legacy: false, runs: { look: "run", make: "run", change: "ask", send: "ask" }, tools }, ...extra,
});
const bigServers = [
    srv("s1", "Linear", "https://mcp.linear.app/mcp", bigLinear),
    srv("s4", "Notion", "https://mcp.notion.com/mcp", notionTools),
    srv("s5", "Sentry", "https://mcp.sentry.dev/mcp", sentryTools, { toolKinds: { openTool, legacy: true, runs: { look: "run", make: "run", change: "ask", send: "ask" }, tools: sentryTools } }),
    { ...imagine, toolKinds: { ...imagine.toolKinds } },
    tavily,
    { id: "s6", name: "Gmail", serverUrl: "https://gmail.example/mcp", authType: "oauth", oauthConnected: false, enabled: true, lastTestedAt: null, lastTestResult: null, createdAt: "2026-11-03T18:30:00Z" },
];
// Today's live code: no headings yet, a server shows its tools' names
const liveServers = bigServers.map((x) => {
    const { toolKinds, ...rest } = x as Record<string, unknown> & { toolKinds?: { tools: Array<{ name: string }> } };
    const names = toolKinds?.tools.map((t) => t.name) ?? [];
    const r = rest as { lastTestResult?: Record<string, unknown> | null };
    return { ...rest, lastTestResult: r.lastTestResult ? { ...r.lastTestResult, toolNames: names } : null };
});
const servers = T === "live" ? liveServers : T === "big" || T === "changed" ? bigServers : T === "imagine" ? [imagine, linear, tavily] : [linear, imagine, tavily];
const call = null as string | null;
const role = (id: string, key: string, name: string, color: string, builtIn: boolean, d: Record<string, boolean>) => ({ id, key, name, color, builtIn, defaults: d });
const all = { chat: true, dm: true, summon: true, manage: true, change: true, send: true };
const roles = [
    role("r-admin", "admin", "Admin", "#F87171", true, all),
    role("r-editor", "editor", "Editor", "#60A5FA", true, { chat: false, dm: false, summon: false, manage: true, change: true, send: true }),
    role("r-member", "member", "Member", "#A78BFA", true, { chat: false, dm: false, summon: false, manage: false, change: true, send: false }),
    role("r-everyone", "everyone", "Everyone", "#A3A3B5", true, { chat: true, dm: true, summon: true, manage: false, change: false, send: false }),
    role("r-eng", "engineering", "Engineering", "#34D399", false, { chat: false, dm: false, summon: false, manage: false, change: false, send: false }),
];
const rule = (id: string, r: (typeof roles)[number], v: Record<string, string>) => ({ id, roleId: r.id, userId: null, role: { key: r.key, name: r.name, color: r.color }, person: null, ...v });
const D = new URLSearchParams(location.search).get("d");
const permissions = readPermissions({
    privateBot: false, refusalReply: null, dailyReplyCap: null, roles,
    rules: [rule("x1", roles[4], D === "live" ? { dm: "yes" } : { change: "yes", send: "yes" }), rule("x2", roles[3], { summon: "no" })],
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
