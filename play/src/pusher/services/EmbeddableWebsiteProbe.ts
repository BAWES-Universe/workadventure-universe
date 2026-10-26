import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import Debug from "debug";
import axios, { isAxiosError } from "axios";
import type { AxiosResponse } from "axios";
import { parsePreviewableUrl, safeLookup } from "./LinkPreviewService";
import { isFrameable } from "./FrameHeaders";

const debug = Debug("embeddable");

const HOP_TIMEOUT_MS = 5_000;
// All hops of one request, redirects included.
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 4;

/** Whether a site can be shown in an iframe. `state` is false when the server can't or mustn't reach it. */
export interface EmbeddableAnswer {
    state: boolean;
    embeddable: boolean;
    message?: string;
}

const UNREACHABLE: EmbeddableAnswer = { state: false, embeddable: false, message: "URL is not reachable" };

interface Agents {
    http: http.Agent;
    https: https.Agent;
}

function agentsWith(lookup: LookupFunction): Agents {
    return { http: new http.Agent({ lookup }), https: new https.Agent({ lookup }) };
}

const safeAgents = agentsWith(safeLookup);

export interface ProbeOptions {
    /** Which URLs the server may fetch, the first one and every redirect. */
    parseUrl?: (raw: string) => URL | undefined;
    lookup?: LookupFunction;
    /** All hops of one request, redirects included. */
    timeoutMs?: number;
}

// A site can sit on any port (https://example.com:8443); the address guard is what keeps the check off internal hosts.
const parseProbeUrl = (raw: string) => parsePreviewableUrl(raw, true);

/**
 * Asks a site whether it lets itself be framed. Any connected player can ask about any URL, so it goes through the
 * same guard as link previews: no internal or reserved address, on the first hop, on each redirect, or after DNS.
 */
export async function probeEmbeddableWebsite(rawUrl: string, options: ProbeOptions = {}): Promise<EmbeddableAnswer> {
    const parseUrl = options.parseUrl ?? parseProbeUrl;
    const url = parseUrl(rawUrl);
    if (!url) {
        return UNREACHABLE;
    }
    const agents = options.lookup ? agentsWith(options.lookup) : safeAgents;
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

    try {
        const response = await requestHeaders("head", url, parseUrl, agents, timeoutMs);
        return { state: true, embeddable: isAllowed(response, url) };
    } catch (error) {
        // If response from server is "Method not allowed", we try to do a GET request
        if (!(isAxiosError(error) && error.response?.status === 405)) {
            return answerForError(rawUrl, error);
        }
    }
    try {
        const response = await requestHeaders("get", url, parseUrl, agents, timeoutMs);
        return { state: true, embeddable: isAllowed(response, url) };
    } catch (error) {
        return answerForError(rawUrl, error);
    }
}

function answerForError(url: string, error: unknown): EmbeddableAnswer {
    // If the error is a 999 error, it means that this is LinkedIn that return this error code because the website is not embeddable and is not reachable by axios
    if (isAxiosError(error) && error.response?.status === 999) {
        return { state: true, embeddable: false };
    }
    debug(`embeddableUrl : ${url} ${error instanceof Error ? error.message : String(error)}`);
    return UNREACHABLE;
}

/** Follows redirects by hand, so each one is checked before it is fetched. Only the headers are read. */
async function requestHeaders(
    method: "head" | "get",
    url: URL,
    parseUrl: (raw: string) => URL | undefined,
    agents: Agents,
    timeoutMs: number
): Promise<AxiosResponse> {
    let current = url;
    const giveUpAt = Date.now() + timeoutMs;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const timeout = Math.min(HOP_TIMEOUT_MS, giveUpAt - Date.now());
        if (timeout <= 0) {
            throw new Error("Timed out");
        }
        // `timeout` only notices an idle socket: a server dripping its headers would never trip it.
        const deadline = new AbortController();
        const timer = setTimeout(() => deadline.abort(), timeout);
        let response: AxiosResponse<Readable>;
        try {
            // Each hop depends on the previous one's answer.
            // eslint-disable-next-line no-await-in-loop
            response = await axios.request<Readable>({
                method,
                url: current.toString(),
                timeout,
                signal: deadline.signal,
                // The address guard lives in the agents below, which only the Node adapter uses.
                adapter: "http",
                maxRedirects: 0,
                // A proxy would resolve the host itself, past our address check.
                proxy: false,
                httpAgent: agents.http,
                httpsAgent: agents.https,
                responseType: "stream",
                validateStatus: (status) => status >= 200 && status < 400,
            });
        } catch (error) {
            if (isAxiosError(error)) {
                (error.response?.data as Readable | undefined)?.destroy?.();
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
        response.data.destroy();

        const location = response.headers.location;
        if (response.status < 300 || typeof location !== "string") {
            return response;
        }
        const next = parseUrl(new URL(location, current).toString());
        if (!next) {
            throw new Error("Redirected to an address the server may not fetch");
        }
        current = next;
    }
    throw new Error("Too many redirects");
}

/** Read from the page that answered, after redirects: both "don't frame me" headers, as the browser reads them. */
function isAllowed(response: AxiosResponse, url: URL): boolean {
    const answered = response.config?.url ? new URL(response.config.url, url) : url;
    const headers = response.headers ?? {};
    return isFrameable(
        {
            "x-frame-options": headers["x-frame-options"] as string | undefined,
            "content-security-policy": headers["content-security-policy"] as string | undefined,
        },
        answered
    );
}
