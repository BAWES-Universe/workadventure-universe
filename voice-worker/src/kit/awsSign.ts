// AWS Signature Version 4, for the AWS calls that go without AWS's SDK (#1886): a presigned socket address (Transcribe) and a
// signed POST (Polly). The secret signs and never leaves the worker; only the key's ID and the signature go. From AWS's own
// description of the signing steps; the time is passed in so a test can pin it.
import { createHash, createHmac } from 'node:crypto';

export interface AwsKey {
    accessKeyId: string;
    secretAccessKey: string;
}

/** The two parts of a key kept as one, "ID:secret" (Orbit). Null when it is not that. */
export function awsKey(key: string): AwsKey | null {
    const split = key.indexOf(':');
    if (split <= 0 || split === key.length - 1) return null;
    return { accessKeyId: key.slice(0, split), secretAccessKey: key.slice(split + 1) };
}

/** AWS's own region names: letters and digits in dashed parts, so nothing else ends up in an address. */
export const AWS_REGION = /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/;

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const hmac = (secret: string | Buffer, value: string) => createHmac('sha256', secret).update(value, 'utf8').digest();
/** RFC 3986: everything but unreserved characters is percent-encoded, in upper case. */
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const stamp = (now: Date) => {
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    return { amzDate, day: amzDate.slice(0, 8) };
};

function signature(key: AwsKey, day: string, region: string, service: string, toSign: string): string {
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${key.secretAccessKey}`, day), region), service), 'aws4_request');
    return createHmac('sha256', signingKey).update(toSign, 'utf8').digest('hex');
}

const canonicalQuery = (params: [string, string][]) =>
    params
        .map(([name, value]) => [encode(name), encode(value)])
        .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1))
        .map(([name, value]) => `${name}=${value}`)
        .join('&');

/** A presigned address (the signature in its query), for a socket that can't carry signed headers: Transcribe's. */
export function presignUrl(url: URL, key: AwsKey, scope: { region: string; service: string }, expiresSeconds = 300, now: Date = new Date()): string {
    const { amzDate, day } = stamp(now);
    const credentialScope = `${day}/${scope.region}/${scope.service}/aws4_request`;
    const params: [string, string][] = [
        ...url.searchParams.entries(),
        ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
        ['X-Amz-Credential', `${key.accessKeyId}/${credentialScope}`],
        ['X-Amz-Date', amzDate],
        ['X-Amz-Expires', String(expiresSeconds)],
        ['X-Amz-SignedHeaders', 'host'],
    ];
    const query = canonicalQuery(params);
    const canonical = ['GET', url.pathname || '/', query, `host:${url.host}`, '', 'host', sha256('')].join('\n');
    const toSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256(canonical)].join('\n');
    return `${url.protocol}//${url.host}${url.pathname}?${query}&X-Amz-Signature=${signature(key, day, scope.region, scope.service, toSign)}`;
}

/** The headers of a signed request with a body (Polly's): content-type, the date and the authorization. */
export function signRequest(
    method: 'POST' | 'GET',
    url: URL,
    body: string,
    contentType: string,
    key: AwsKey,
    scope: { region: string; service: string },
    now: Date = new Date(),
): Record<string, string> {
    const { amzDate, day } = stamp(now);
    const credentialScope = `${day}/${scope.region}/${scope.service}/aws4_request`;
    const signedHeaders = 'content-type;host;x-amz-date';
    const canonical = [
        method,
        url.pathname || '/',
        canonicalQuery([...url.searchParams.entries()]),
        `content-type:${contentType}`,
        `host:${url.host}`,
        `x-amz-date:${amzDate}`,
        '',
        signedHeaders,
        sha256(body),
    ].join('\n');
    const toSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256(canonical)].join('\n');
    return {
        'content-type': contentType,
        'x-amz-date': amzDate,
        authorization: `AWS4-HMAC-SHA256 Credential=${key.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature(key, day, scope.region, scope.service, toSign)}`,
    };
}
