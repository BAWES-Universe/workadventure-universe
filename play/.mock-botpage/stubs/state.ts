// One storyboard state per ?s=. Who looks (khalid: Owner with My Claude; sara: the maker with My DeepSeek; omar: manages bots, no keys) and where the bot runs
export const s = new URLSearchParams(location.search).get("s") ?? "k-theirs";
const table: Record<string, { viewer: "khalid" | "sara" | "omar"; on: string; bot?: string }> = {
    "k-theirs": { viewer: "khalid", on: "key-sara" },
    "k-after": { viewer: "khalid", on: "key-khalid" },
    "k-uai": { viewer: "khalid", on: "universe-ai" },
    "k-left": { viewer: "khalid", on: "universe-ai", bot: "Micho" },
    "sara-moved": { viewer: "sara", on: "key-khalid" },
    "sara-after": { viewer: "sara", on: "key-sara" },
    omar: { viewer: "omar", on: "key-khalid" },
};
export const state = table[s] ?? table["k-theirs"];
