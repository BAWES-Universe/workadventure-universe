// Universe's logo, built into the game: the screens that open before the room has loaded (a network error, a refused
// connection), or when Orbit's logo can't be downloaded, still show it. A data URI, so it needs no request.
import universeLogoSvg from "./universe-logo.svg?raw";

export const universeLogo = `data:image/svg+xml,${encodeURIComponent(universeLogoSvg)}`;
