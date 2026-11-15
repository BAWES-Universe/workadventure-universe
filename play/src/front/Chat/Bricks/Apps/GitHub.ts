/**
 * Connect GitHub for Bricks (game #2041): what Orbit says about a person's GitHub on its app page (`github` in
 * `/api/me/apps/:id`): who it is signed in as, where Universe's GitHub app works for them, where it waits for an owner's
 * OK, and the GitHub pages to send them to. Nothing in here talks to a server, so every rule can be unit tested.
 */

export interface GitHubPlace {
    account: string;
    type: "User" | "Organization";
    /** "all" for every repo there, or how many were picked */
    repos: "all" | number;
    manageUrl: string;
}

export interface GitHubWhere {
    login: string | null;
    /** A key the person pasted is used instead of the sign-in */
    ownKey: boolean;
    places: GitHubPlace[];
    /** Organizations where the person asked for the app and an owner has not said OK yet */
    waiting: { account: string; type: "User" | "Organization" }[];
    addPlaceUrl: string;
    installUrl: string;
    ownKeyPage: string;
    /** False when GitHub could not be asked just now: the lists are empty, not known to be */
    known: boolean;
}

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/** Only GitHub's own pages are opened from here: anything else Orbit might send is not a GitHub page. */
const gitHubPage = (value: unknown): string | undefined => {
    const url = text(value);
    if (!url) return undefined;
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" && parsed.hostname === "github.com" ? url : undefined;
    } catch {
        return undefined;
    }
};

const kind = (value: unknown): "User" | "Organization" => (value === "User" ? "User" : "Organization");

function place(value: unknown): GitHubPlace | undefined {
    if (!isRaw(value)) return undefined;
    const account = text(value.account);
    const manageUrl = gitHubPage(value.manageUrl);
    const repos =
        value.repos === "all"
            ? "all"
            : typeof value.repos === "number" && Number.isInteger(value.repos) && value.repos >= 0
            ? value.repos
            : undefined;
    if (!account || !manageUrl || repos === undefined) return undefined;
    return { account, type: value.type === "User" ? "User" : "Organization", repos, manageUrl };
}

/** `github` in `/api/me/apps/:id`; undefined when it is not there or not that (the page then shows the plain app). */
export function parseGitHubWhere(value: unknown): GitHubWhere | undefined {
    if (!isRaw(value) || !Array.isArray(value.places) || !Array.isArray(value.waiting)) return undefined;
    const addPlaceUrl = gitHubPage(value.addPlaceUrl);
    const installUrl = gitHubPage(value.installUrl);
    const ownKeyPage = gitHubPage(value.ownKeyPage);
    if (!addPlaceUrl || !installUrl || !ownKeyPage) return undefined;
    const places = value.places.map(place).filter((one): one is GitHubPlace => !!one);
    const waiting = value.waiting
        .filter(isRaw)
        .map((one) => ({ account: text(one.account) ?? "", type: kind(one.type) }))
        .filter((one) => one.account !== "");
    return {
        login: text(value.login) ?? null,
        ownKey: value.ownKey === true,
        places,
        waiting,
        addPlaceUrl,
        installUrl,
        ownKeyPage,
        known: value.known === true,
    };
}

/** The install link as people read it, without https:// ("github.com/apps/bawes-universe/installations/new"). */
export const shortLink = (url: string): string => url.replace(/^https:\/\//, "");

/** A pasted key, cleaned of the spaces and line breaks a copy brings along; empty when it cannot be a key. */
export function cleanKey(value: string): string {
    const key = value.replace(/\s+/g, "");
    return key.length >= 10 && key.length <= 500 ? key : "";
}
