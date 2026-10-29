import type { AxiosRequestConfig } from "axios";
import axios, { isAxiosError } from "axios";
import { z } from "zod";
import { ADMIN_API_TOKEN, ADMIN_API_URL } from "../enums/EnvironmentVariable";

/**
 * An artifact request Orbit refused, or that cannot be made at all.
 * `code` is Orbit's error code (not_found, version_not_found...); `status` is the HTTP status the browser gets.
 */
export class ArtifactsError extends Error {
    constructor(public readonly code: string, public readonly status: number) {
        super(code);
        this.name = "ArtifactsError";
    }
}

/** Who is looking, as Orbit names a person: a signed-in account by its uuid or email, or a guest. */
export interface ArtifactPerson {
    signedIn: boolean;
    identifier: string | null;
}

export interface ArtifactViewer {
    person: ArtifactPerson;
    /** The pusher vouches for it: the person is in the chat named in `chat`, right now. */
    inChat: boolean;
    /** The chat the person is vouched for; Orbit counts `inChat` only when it is the chat the artifact was made in. */
    chat?: { kind: "nearby" | "dm"; ref: string };
}

const VersionView = z.object({
    number: z.number(),
    summary: z.string().nullable(),
    askedByName: z.string().nullable(),
    sizeBytes: z.number(),
    createdAt: z.string(),
    url: z.string(),
});
export type ArtifactVersionView = z.infer<typeof VersionView>;

const ArtifactView = z.object({
    id: z.string(),
    title: z.string(),
    kind: z.string(),
    makerName: z.string(),
    owner: z.object({ name: z.string().nullable() }).nullable(),
    version: z.number(),
    openScope: z.string(),
    changeScope: z.string(),
    chatKind: z.string().nullable(),
    expiresAt: z.string().nullable(),
});

const Rights = z.object({
    owner: z.boolean(),
    change: z.boolean(),
    manage: z.boolean(),
    copy: z.boolean(),
    // In the chat it was made in right now (game #1584); an Orbit that does not say it yet counts as not in it
    inChat: z.boolean().optional(),
});

const Opened = z.object({ artifact: ArtifactView, version: VersionView, you: Rights });
export type OpenedArtifact = z.infer<typeof Opened>;

const Shared = z.object({ artifact: ArtifactView });
export type SharedArtifact = z.infer<typeof Shared>;

/** Who can open it: people in the chat it was made in, or anyone with the link. */
export const OPEN_SCOPES = ["chat", "link"] as const;
/** Who can ask for changes: only its owner, or everyone who can open it, in its chat. */
export const CHANGE_SCOPES = ["owner", "openers"] as const;

export interface ArtifactSharing {
    openScope?: (typeof OPEN_SCOPES)[number];
    changeScope?: (typeof CHANGE_SCOPES)[number];
}

/** A row of a chat's list (game #1474): also when it last changed and whether it is the asking person's own. */
const ChatArtifactView = ArtifactView.extend({ yours: z.boolean(), updatedAt: z.string() });
const ChatArtifactPage = z.object({
    artifacts: z.array(ChatArtifactView),
    total: z.number().int().min(0),
    next: z.number().int().min(0).nullable(),
});
export type ChatArtifactPage = z.infer<typeof ChatArtifactPage>;

/** A row of Your artifacts (game #1609): every one the person owns, with when it last changed. */
const OwnedArtifactView = ArtifactView.extend({ updatedAt: z.string() });
const OwnedArtifactPage = z.object({
    artifacts: z.array(OwnedArtifactView),
    total: z.number().int().min(0),
    next: z.number().int().min(0).nullable(),
});
export type OwnedArtifactPage = z.infer<typeof OwnedArtifactPage>;

const VersionList = z.object({ versions: z.array(VersionView) });
const VersionCode = z.object({ version: VersionView, content: z.string() });
export type ArtifactVersionCode = z.infer<typeof VersionCode>;

const OrbitErrorBody = z.object({ error: z.string() });

interface HttpClient {
    post(url: string, body: unknown, config: AxiosRequestConfig): Promise<{ data: unknown }>;
    put(url: string, body: unknown, config: AxiosRequestConfig): Promise<{ data: unknown }>;
}

/**
 * Client of Orbit's artifact routes for the game (live artifacts, game #1422, Orbit #622). The pusher is the game's
 * server: it names the person from their signed token and says whether they are in the chat the artifact was made in,
 * so the browser can never claim either.
 */
export class ArtifactsService {
    constructor(
        private readonly baseUrl: string | undefined,
        private readonly token: string | undefined,
        private readonly http: HttpClient = axios
    ) {}

    isEnabled(): boolean {
        return !!this.baseUrl && !!this.token;
    }

    /** What the box opens on (the latest version unless one is asked for) and what this person may do with it. */
    open(id: string, viewer: ArtifactViewer, version?: number): Promise<OpenedArtifact> {
        return this.call(`/api/artifacts/${encodeURIComponent(id)}/open`, { viewer, version }, Opened);
    }

    async listVersions(id: string, viewer: ArtifactViewer): Promise<ArtifactVersionView[]> {
        const answer = await this.call(`/api/artifacts/${encodeURIComponent(id)}/versions`, { viewer }, VersionList);
        return answer.versions;
    }

    /** The owner makes an older version the latest again: a new version with its file, so nothing is lost. */
    restore(id: string, number: number, viewer: ArtifactViewer): Promise<OpenedArtifact> {
        return this.call(`/api/artifacts/${encodeURIComponent(id)}/restore`, { viewer, number }, Opened);
    }

    /** The owner says who can open it and who can ask for changes; the answer is the artifact as it now is. */
    share(id: string, sharing: ArtifactSharing, viewer: ArtifactViewer): Promise<SharedArtifact> {
        return this.call(`/api/artifacts/${encodeURIComponent(id)}/share`, { viewer, ...sharing }, Shared, "put");
    }

    /** The code of one version, for the Code view. */
    readCode(id: string, number: number, viewer: ArtifactViewer): Promise<ArtifactVersionCode> {
        return this.call(`/api/artifacts/${encodeURIComponent(id)}/versions/${number}`, { viewer }, VersionCode);
    }

    /**
     * The artifacts made in this chat that the person may open, newest change first, a page at a time (the chat's
     * Artifacts group and list). `offset` is where the page starts: the `next` of the page before.
     */
    listInChat(viewer: ArtifactViewer, offset = 0): Promise<ChatArtifactPage> {
        return this.call("/api/artifacts/chat", { viewer, offset }, ChatArtifactPage);
    }

    /**
     * Every artifact the person owns, from every chat and bot, newest change first, a page at a time (Your artifacts in
     * the window, game #1609). A guest owns none.
     */
    listOwned(person: ArtifactPerson, offset = 0): Promise<OwnedArtifactPage> {
        return this.call("/api/artifacts/owned", { person, offset }, OwnedArtifactPage);
    }

    private async call<T>(
        path: string,
        body: unknown,
        answer: z.ZodType<T>,
        method: "post" | "put" = "post"
    ): Promise<T> {
        if (!this.isEnabled()) {
            throw new ArtifactsError("artifacts_unavailable", 503);
        }
        try {
            const response = await this.http[method](`${this.baseUrl}${path}`, body, {
                headers: { Authorization: `${this.token}` },
            });
            return answer.parse(response.data);
        } catch (e) {
            if (isAxiosError(e) && e.response && e.response.status >= 400 && e.response.status < 500) {
                const error = OrbitErrorBody.safeParse(e.response.data);
                throw new ArtifactsError(error.success ? error.data.error : "refused", e.response.status);
            }
            throw e;
        }
    }
}

export const artifactsService = new ArtifactsService(ADMIN_API_URL, ADMIN_API_TOKEN);
