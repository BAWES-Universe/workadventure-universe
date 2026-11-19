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
    /**
     * Where the file is served from: an address outside the game's own, so a page that runs from it is cut off. None for
     * a "Just you" artifact (game #1994) anywhere but in the answer to its owner opening it.
     */
    url: string | null;
    /**
     * How long that address goes on working: the one a "Just you" artifact opens at is for that opening only. None for an
     * address that never stops.
     */
    urlLifeMs?: number;
    /** The page has songs, pictures or videos beside it, which it may fetch from that address at any moment. */
    urlHasMedia?: boolean;
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
        /** The kind of chat it was made in; a copy has none. */
        chatKind: string | null;
        expiresAt: string | null;
    };
    version: ArtifactVersionInfo;
    /** `inChat`: in the chat it was made in right now, as the game's server vouched. */
    you: { owner: boolean; change: boolean; manage: boolean; copy: boolean; inChat?: boolean };
}

/** One artifact made in a chat, as its Artifacts group and list show it (game #1474). */
export interface ChatArtifact {
    id: string;
    title: string;
    kind: string;
    makerName: string;
    /** The person who asked for it; null for a guest's. */
    owner: { name: string | null } | null;
    version: number;
    /** Whether it is the asking person's own: the row names the owner only when it isn't. */
    yours: boolean;
    updatedAt: string;
}

/** One page of a chat's artifacts: `total` in all, and where the next page starts (null at the end). */
export interface ChatArtifactPage {
    artifacts: ChatArtifact[];
    total: number;
    next: number | null;
}

/** An artifact request the game's server refused or could not make. */
export class ArtifactRequestError extends Error {
    /** `unsure`: a payment start that was refused may still have made an order; Check payment stays offered for that wish */
    constructor(public readonly status: number, public readonly code: string, public readonly unsure = false) {
        super(code);
        this.name = "ArtifactRequestError";
    }
    /** It is gone, or this person may not open it from here: nothing to try again. */
    get notAvailable(): boolean {
        return this.status === 404;
    }
}

async function post<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
        response = await fetch(`${ABSOLUTE_PUSHER_URL}artifacts/${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: localUserStore.getAuthToken() ?? "" },
            body: JSON.stringify(body),
            signal,
        });
    } catch {
        throw new ArtifactRequestError(0, "offline");
    }
    if (!response.ok) {
        const answer = (await response.json().catch(() => undefined)) as
            | { error?: unknown; unsure?: unknown }
            | undefined;
        throw new ArtifactRequestError(
            response.status,
            typeof answer?.error === "string" ? answer.error : "failed",
            answer?.unsure === true
        );
    }
    return (await response.json()) as T;
}

/** The artifact, the version to show (the latest unless one is asked for) and what this person may do with it. */
export function fetchArtifact(id: string, chat: ArtifactChat | undefined, version?: number): Promise<OpenedArtifact> {
    return post<OpenedArtifact>(`${encodeURIComponent(id)}/open`, { chat, version });
}

/** The artifacts made in this chat that this person may open, newest change first, from `offset` on. */
export function fetchChatArtifacts(chat: ArtifactChat, offset = 0): Promise<ChatArtifactPage> {
    return post<ChatArtifactPage>("in-chat", { chat, offset });
}

/** Every artifact this person owns, from every chat and bot, newest change first, from `offset` on (game #1609). */
export async function fetchYourArtifacts(offset = 0): Promise<ChatArtifactPage> {
    const page = await post<ChatArtifactPage>("owned", { offset });
    return { ...page, artifacts: page.artifacts.map((artifact) => ({ ...artifact, yours: true })) };
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

/** Who can open it: just its owner, people in the chat it was made in, or anyone with the link. */
export type ArtifactOpenScope = "me" | "chat" | "link";
export type ArtifactChangeScope = "owner" | "openers";

/** The owner says who can open it and who can ask for changes; the answer is the artifact as it now is. */
export async function shareArtifact(
    id: string,
    sharing: { openScope?: ArtifactOpenScope; changeScope?: ArtifactChangeScope },
    chat: ArtifactChat | undefined
): Promise<OpenedArtifact["artifact"]> {
    return (
        await post<{ artifact: OpenedArtifact["artifact"] }>(`${encodeURIComponent(id)}/share`, { chat, ...sharing })
    ).artifact;
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

/** The payment side of a page that takes payments (game #2044): nothing but what the page's window may know. */
export interface ArtifactPay {
    enabled?: boolean;
    orderId?: string | null;
    /** Where the buyer pays; only an https address is ever opened */
    checkoutUrl?: string | null;
    app?: string;
    /** `none`: a restore found no purchase of this buyer's */
    status?: "checking" | "paid" | "not_paid" | "cant_confirm" | "none";
    testPayment?: boolean;
    /** How long to wait before asking about the order again, in milliseconds (the server slows it down for an order that waits) */
    pollAfterMs?: number;
    /** When a restored purchase was paid (ISO), so the line can say "Your purchase from 19 Nov is back." */
    paidAt?: string | null;
    /** A start sent again found the order it had made, and made no second one */
    reused?: boolean;
    /**
     * What Orbit used for the person who ASKED: `account` for a real signed-in account, `guest` for the recovery code (a signed-in person
     * whose Orbit account is a guest account is a guest). It is the asking person's kind, not the order's: never given to the page.
     */
    buyer?: "account" | "guest";
}

/** What the window asks of the payment side of a page: one of start, order, check or restore. */
export interface ArtifactPayRequest {
    /** A checkout for the owner's amount. With `intentId`, a start sent again finds the order it made. */
    start?: boolean;
    /** Where one order stands */
    order?: string;
    /** The window's own id for one purchase wish: made here for each tap, never by the page */
    intentId?: string;
    /** Check payment: where the order that wish made stands */
    check?: boolean;
    /** Restore purchase: this buyer's verified paid order for the page's offer */
    restore?: boolean;
    /** What a guest's window keeps for them (Orbit stores only its hash), and the code of a receipt link they opened */
    recoveryCode?: string;
    receiptCode?: string;
}

/** Whether the page takes payments; `start` makes a checkout for the owner's amount, `order` asks where an order stands, `check` and `restore` get back to a purchase. */
export function payOnArtifact(
    id: string,
    chat: ArtifactChat | undefined,
    request: ArtifactPayRequest = {},
    /** Lets the caller stop waiting for the answer for good (the request is dropped, its answer never read) */
    signal?: AbortSignal
): Promise<ArtifactPay> {
    return post<ArtifactPay>(`${encodeURIComponent(id)}/pay`, { chat, ...request }, signal);
}
