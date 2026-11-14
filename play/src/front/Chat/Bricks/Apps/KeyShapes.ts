/**
 * Words a person pastes that look like a key from a payment or service provider (`sk_live_…`, `sk_test_…`, a long bearer token). The
 * message box warns before such words are sent, and offers the safe form. Deliberately narrow: a missed one is caught on the server
 * too (bots/ai/KeyTools.ts), and a wrongly caught one only asks.
 */
const KEY_SHAPES = [
    /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{12,}\b/,
    /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}\b/,
    /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/i,
];

export function looksLikeAKeyPastedWords(words: string): boolean {
    return KEY_SHAPES.some((shape) => shape.test(words));
}

