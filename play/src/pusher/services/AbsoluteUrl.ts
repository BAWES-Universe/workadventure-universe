/** Link previews need a full URL: a relative image is resolved against the page it is on. */
export function absoluteUrl(src: string, pageUrl: string): string {
    try {
        return new URL(src, pageUrl).toString();
    } catch {
        return src;
    }
}
