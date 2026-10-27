import { ABSOLUTE_PUSHER_URL } from "../Enum/ComputedConst";
import { localUserStore } from "../Connection/LocalUserStore";
import { ADMIN_URL } from "../Enum/EnvironmentVariable";

/** The chat a card was seen in: the bubble's space (as the bots name it) or the Matrix room of a direct chat. */
export interface ArtifactChat {
    kind: "nearby" | "dm";
    ref: string;
}

export interface ArtifactVersionInfo {
    number: number;
    summary: string | null;
    askedByName: string | null;
    sizeBytes: number;
    createdAt: string;
    /** Where the file is served from: an address outside the game's own, so a page that runs from it is cut off. */
    url: string;
}

export interface OpenedArtifact {
    artifact: {
        id: string;
        title: string;
        kind: string;
        makerName: string;
        version: number;
        openScope: string;
        changeScope: string;
        expiresAt: string | null;
    };
    version: ArtifactVersionInfo;
    you: { owner: boolean; change: boolean; manage: boolean; copy: boolean };
}

/** An artifact request the game's server refused or could not make. */
export class ArtifactRequestError extends Error {
    constructor(public readonly status: number, public readonly code: string) {
        super(code);
        this.name = "ArtifactRequestError";
    }
    /** It is gone, or this person may not open it from here: nothing to try again. */
    get notAvailable(): boolean {
        return this.status === 404;
    }
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
        response = await fetch(`${ABSOLUTE_PUSHER_URL}artifacts/${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: localUserStore.getAuthToken() ?? "" },
            body: JSON.stringify(body),
        });
    } catch {
        throw new ArtifactRequestError(0, "offline");
    }
    if (!response.ok) {
        const answer = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined;
        throw new ArtifactRequestError(response.status, typeof answer?.error === "string" ? answer.error : "failed");
    }
    return (await response.json()) as T;
}

/** The artifact, the version to show (the latest unless one is asked for) and what this person may do with it. */
export function fetchArtifact(id: string, chat: ArtifactChat | undefined, version?: number): Promise<OpenedArtifact> {
    return post<OpenedArtifact>(`${encodeURIComponent(id)}/open`, { chat, version });
}

/** Every version, newest first. */
export async function fetchArtifactVersions(
    id: string,
    chat: ArtifactChat | undefined
): Promise<ArtifactVersionInfo[]> {
    return (await post<{ versions: ArtifactVersionInfo[] }>(`${encodeURIComponent(id)}/versions`, { chat })).versions;
}

/** The owner makes an older version the latest again; the answer is the artifact with that new latest version. */
export function restoreArtifactVersion(
    id: string,
    number: number,
    chat: ArtifactChat | undefined
): Promise<OpenedArtifact> {
    return post<OpenedArtifact>(`${encodeURIComponent(id)}/restore`, { chat, number });
}

export type ArtifactOpenScope = "chat" | "link";
export type ArtifactChangeScope = "owner" | "openers";

/** The owner says who can open it and who can ask for changes; the answer is the artifact as it now is. */
export async function shareArtifact(
    id: string,
    sharing: { openScope?: ArtifactOpenScope; changeScope?: ArtifactChangeScope },
    chat: ArtifactChat | undefined
): Promise<OpenedArtifact["artifact"]> {
    return (await post<{ artifact: OpenedArtifact["artifact"] }>(`${encodeURIComponent(id)}/share`, { chat, ...sharing }))
        .artifact;
}

/** The page "Anyone with the link" opens: Orbit's, view only and without signing in. None without Orbit. */
export function artifactLink(id: string, orbitUrl: string | undefined = ADMIN_URL): string | undefined {
    if (!orbitUrl) return undefined;
    return `${orbitUrl.replace(/\/+$/, "")}/a/${encodeURIComponent(id)}`;
}

/** The text of one version, for the Code view and for a document. */
export function fetchArtifactCode(
    id: string,
    number: number,
    chat: ArtifactChat | undefined
): Promise<{ version: ArtifactVersionInfo; content: string }> {
    return post(`${encodeURIComponent(id)}/versions/${number}`, { chat });
}
