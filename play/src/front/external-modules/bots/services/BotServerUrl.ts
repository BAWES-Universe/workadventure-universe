import { BOT_SERVER_URL } from "../../../Enum/EnvironmentVariable";

/**
 * Get bot-server URL from current environment
 * BOT_SERVER_URL wins when set. Hosts that don't follow the play.<domain> pattern need it:
 * dev.bawes.net would otherwise derive bot-server.bawes.net, which is production's bot server.
 * Otherwise derives from current window location by replacing the first subdomain with 'bot-server'
 * Works for:
 * - play.workadventure.localhost -> bot-server.workadventure.localhost
 * - play.workadventu.re -> bot-server.workadventu.re
 * - localhost:8080 -> bot-server.workadventure.localhost (fallback)
 * - Any custom domain -> bot-server.{rest of domain}
 */
export function getBotServerUrl(): string {
    if (BOT_SERVER_URL) {
        return BOT_SERVER_URL.replace(/\/+$/, "");
    }
    try {
        const { protocol, hostname, port } = window.location;

        // Handle localhost (development)
        if (hostname === "localhost" || hostname === "127.0.0.1") {
            // For localhost, use the standard dev domain
            return `${protocol}//bot-server.workadventure.localhost${port ? `:${port}` : ""}`;
        }

        // Handle subdomain patterns (most common case)
        // play.workadventure.localhost -> bot-server.workadventure.localhost
        // play.workadventu.re -> bot-server.workadventu.re
        if (hostname.includes(".")) {
            const parts = hostname.split(".");
            // Replace first subdomain with 'bot-server'
            parts[0] = "bot-server";
            const newHostname = parts.join(".");
            return `${protocol}//${newHostname}${port ? `:${port}` : ""}`;
        }

        // Single word hostname (unlikely but handle gracefully)
        return `${protocol}//bot-server.${hostname}${port ? `:${port}` : ""}`;
    } catch (e) {
        console.warn("[Bot Extension] Failed to derive bot-server URL from location:", e);
        // Ultimate fallback - use standard dev domain
        return "http://bot-server.workadventure.localhost";
    }
}
