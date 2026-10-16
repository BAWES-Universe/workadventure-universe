/**
 * The picture of the app, for the card and the guides: the home screen icon Orbit sent with the room (Universe on
 * ink), else the page's own icon. Undefined when the page has none.
 */
export function installIconSrc(doc: Document = document): string | undefined {
    const link =
        doc.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]') ??
        doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
    return link?.href || undefined;
}
