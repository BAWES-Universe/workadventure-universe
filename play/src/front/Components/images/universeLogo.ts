// Universe's logo, built into the game: the screens that open before the room has loaded (a network error, a refused
// connection), or when Orbit's logo can't be downloaded, still show it. A data URI, so it needs no request.
import universeLogoSvg from "./universe-logo.svg?raw";
import universeWordmarkSvg from "./universe-wordmark.svg?raw";

export const universeLogo = `data:image/svg+xml,${encodeURIComponent(universeLogoSvg)}`;

// The white wordmark of the loading screen (#boot-splash in index.html, which can't import it): the Connecting and
// Reconnecting screens show it at the same size, so the logo doesn't change between them.
export const universeWordmark = `data:image/svg+xml,${encodeURIComponent(universeWordmarkSvg)}`;
