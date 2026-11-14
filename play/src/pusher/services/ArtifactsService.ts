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
    // Null for a "Just you" artifact (game #1994) everywhere but in the answer to its owner opening it
    url: z.string().nullable(),
});
export type ArtifactVersionView = z.infer<typeof VersionView>;

/**
 * The version an opening shows. The address of a "Just you" artifact is for that one opening and stops: Orbit says when
 * (`urlExpiresAt`), and names the songs, pictures and videos beside the page (`media`), which a page left open goes on
 * fetching from that address.
 */
const OpenedVersionAnswer = VersionView.extend({
    urlExpiresAt: z.string().optional(),
    media: z.array(z.unknown()).optional(),
});

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
const OpenedAnswer = Opened.extend({ version: OpenedVersionAnswer });

/** What the browser is told about the address of the version on show, when that address stops (a "Just you" one). */
export interface ArtifactAddressLife {
    /**
     * How long the address goes on working, from now. A length of time and not a moment, so that a browser whose clock
     * is wrong still asks for a new one in time.
     */
    urlLifeMs?: number;
    /** The page has songs, pictures or videos beside it, which it may fetch from that address at any moment. */
    urlHasMedia?: boolean;
}
export type OpenedArtifact = Omit<z.infer<typeof Opened>, "version"> & {
    version: ArtifactVersionView & ArtifactAddressLife;
};

const Shared = z.object({ artifact: ArtifactView });
export type SharedArtifact = z.infer<typeof Shared>;

/** Who can open it: just its owner (game #1994), people in the chat it was made in, or anyone with the link. */
/**
 * A page that takes payments, as the game's window may know it (game #2044): whether it does, the checkout the owner's amount
 * made, and where an order stands. Nothing of the key, the amount's terms or the service's own answer comes through.
 */
const PayAnswer = z.object({
    enabled: z.boolean().optional(),
    orderId: z.string().optional(),
    checkoutUrl: z.string().nullable().optional(),
    app: z.string().optional(),
    status: z.enum(["checking", "paid", "not_paid", "cant_confirm"]).optional(),
    testPayment: z.boolean().optional(),
});
export type ArtifactPayAnswer = z.infer<typeof PayAnswer>;

export const OPEN_SCOPES = ["me", "chat", "link"] as const;
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

/**
 * Orbit cannot keep files private as it is set up (it does not know its own address). Not a breakdown: the browser is
 * told which, so "Just you" is never shown as saved when it was not.
 */
const PRIVATE_FILES_OFF = "private_files_not_configured";

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
        private readonly http: HttpClient = axios,
        private readonly now: () => number = Date.now
    ) {}

    isEnabled(): boolean {
        return !!this.baseUrl && !!this.token;
    }

    /** What the box opens on (the latest version unless one is asked for) and what this person may do with it. */
    async open(id: string, viewer: ArtifactViewer, version?: number): Promise<OpenedArtifact> {
        const answer = await this.call(
            `/api/artifacts/${encodeURIComponent(id)}/open`,
            { viewer, version },
            OpenedAnswer
        );
        const { urlExpiresAt, media, ...shown } = answer.version;
        // An address that never stops (every artifact but a "Just you" one) has no life to tell
        const life = shown.url !== null && urlExpiresAt ? Date.parse(urlExpiresAt) - this.now() : NaN;
        return {
            ...answer,
            version: {
                ...shown,
                ...(Number.isFinite(life) && life > 0
                    ? { urlLifeMs: life, ...(media?.length ? { urlHasMedia: true } : {}) }
                    : {}),
            },
        };
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

    /**
     * The payment side of a page (game #2044). With neither `start` nor `order`: whether the page takes payments. `start`
     * makes a checkout for the owner's amount (the viewer sends no amount); `order` asks where an order stands.
     */
    pay(id: string, request: { start?: boolean; order?: string }, viewer: ArtifactViewer): Promise<ArtifactPayAnswer> {
        return this.call(`/api/artifacts/${encodeURIComponent(id)}/pay`, { viewer, ...request }, PayAnswer);
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
            if (isAxiosError(e) && e.response) {
                const error = OrbitErrorBody.safeParse(e.response.data);
                if (e.response.status >= 400 && e.response.status < 500) {
                    throw new ArtifactsError(error.success ? error.data.error : "refused", e.response.status);
                }
                if (error.success && error.data.error === PRIVATE_FILES_OFF) {
                    throw new ArtifactsError(PRIVATE_FILES_OFF, e.response.status);
                }
            }
            throw e;
        }
    }
}

export const artifactsService = new ArtifactsService(ADMIN_API_URL, ADMIN_API_TOKEN);
