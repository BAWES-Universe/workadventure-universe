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

const Rights = z.object({ owner: z.boolean(), change: z.boolean(), manage: z.boolean(), copy: z.boolean() });

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
