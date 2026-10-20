/**
 * A failed axios call throws an AxiosError that carries the whole request: its headers (the bot service token, the
 * admin token, a player's Orbit session, an MCP server's key), its body (transcripts, memory) and the raw socket
 * request. The bot server logs those errors with `console.error(..., error)` in many places, and Sentry's console
 * logging turns each argument into a log attribute with `JSON.stringify`, so all of that reached the container logs
 * and Sentry Logs whenever Orbit or an MCP server failed.
 *
 * This interceptor runs once, before any caller sees the error, and keeps only what is useful for debugging: the
 * method, the address without secret query values, the status and the answer. Callers still get the same AxiosError
 * (`axios.isAxiosError`, `error.response.status` and `error.response.data` are unchanged).
 */

import axios, { type AxiosError } from 'axios';

const REDACTED = '[redacted]';
const SECRET_NAME = /auth|token|key|secret|cookie|session|password|signature|sig$/i;

function redactHeaders(headers: unknown): void {
    if (!headers || typeof headers !== 'object') return;
    const record = headers as Record<string, unknown>;
    for (const name of Object.keys(record)) {
        if (SECRET_NAME.test(name) && record[name] !== undefined && record[name] !== null) {
            record[name] = REDACTED;
        }
    }
}

/** The address with every secret-looking query value replaced, so a key passed as `?key=` stays out of the logs. */
export function redactUrl(url: string): string {
    const queryStart = url.indexOf('?');
    if (queryStart === -1) return url;
    const params = new URLSearchParams(url.slice(queryStart + 1));
    let changed = false;
    for (const name of [...params.keys()]) {
        if (SECRET_NAME.test(name)) {
            params.set(name, REDACTED);
            changed = true;
        }
    }
    return changed ? `${url.slice(0, queryStart)}?${params.toString()}` : url;
}

/** Hide a property from logging (`util.inspect`, `JSON.stringify`) while leaving it readable for code. */
function hide(target: object, property: string): void {
    if (!Object.prototype.hasOwnProperty.call(target, property)) return;
    const value = (target as Record<string, unknown>)[property];
    Object.defineProperty(target, property, { value, enumerable: false, configurable: true, writable: true });
}

export function redactAxiosError(error: unknown): unknown {
    if (!axios.isAxiosError(error)) return error;
    const axiosError = error as AxiosError;
    const config = axiosError.config;
    if (config) {
        redactHeaders(config.headers);
        if (typeof config.url === 'string') config.url = redactUrl(config.url);
        // The request body (a transcript, a memory, an MCP call's arguments) is never needed to read the error
        if (config.data !== undefined) {
            config.data = typeof config.data === 'string' ? `${REDACTED} ${config.data.length} chars` : REDACTED;
        }
        // A copy: the params object is the caller's own, which it may send again
        if (config.params && typeof config.params === 'object') {
            config.params = { ...(config.params as Record<string, unknown>) };
            redactHeaders(config.params);
        }
        // `auth` is axios's basic-auth option
        if (config.auth) config.auth = { username: REDACTED, password: REDACTED };
    }
    // The raw request holds the headers as one written string (`_header`), out of reach of the steps above
    hide(axiosError, 'request');
    if (axiosError.response) {
        hide(axiosError.response, 'request');
        hide(axiosError.response, 'config');
    }
    return error;
}

let installed = false;

/** Install the interceptor on axios's default instance, which is the one every bot server module uses. */
export function installAxiosErrorRedaction(): void {
    if (installed) return;
    installed = true;
    axios.interceptors.response.use(undefined, (error: unknown) => Promise.reject(redactAxiosError(error)));
}
