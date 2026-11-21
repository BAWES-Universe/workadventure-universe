import { coWebsites } from "../Stores/CoWebsiteStore";
import { StudentHubCoWebsite } from "../WebRtc/CoWebsite/StudentHubCoWebsite";
import { localUserStore } from "../Connection/LocalUserStore";
import { STUDENTHUB_EMBED_ORIGIN, STUDENTHUB_URL } from "../Enum/EnvironmentVariable";
import { ABSOLUTE_PUSHER_URL } from "../Enum/ComputedConst";
import { StudentHubLauncher } from "./StudentHubLauncher";

/** The game's one StudentHub launcher (E3), wired to the window's items, the device's token and the pusher. */
export const studentHubLauncher = new StudentHubLauncher({
    studentHubUrl: STUDENTHUB_URL || undefined,
    embedOrigin: STUDENTHUB_EMBED_ORIGIN || undefined,
    pusherUrl: ABSOLUTE_PUSHER_URL,
    getAuthToken: () => localUserStore.getAuthToken(),
    setAuthToken: (token) => localUserStore.setAuthToken(token),
    isLogged: () => localUserStore.isLogged(),
    openCoWebsite: (url, onIframe) => {
        const coWebsite = new StudentHubCoWebsite(url, onIframe);
        coWebsites.add(coWebsite);
        return {
            close: () => coWebsites.remove(coWebsite),
            isOpen: () => coWebsites.findById(coWebsite.getId()) !== undefined,
        };
    },
    openTab: (url) => {
        window.open(url, "_blank", "noopener,noreferrer");
    },
    fetch: (input, init) => fetch(input, init),
});

// Signing out, or signing in as someone else, in this tab.
localUserStore.onAuthTokenChange((token) => studentHubLauncher.authTokenChanged(token));
// The same in another tab of this browser: the token kept on the device changes here too (a cleared storage included).
// Like the launcher, this lives as long as the page.
function onStorage(event: StorageEvent): void {
    if (event.storageArea === localStorage && (event.key === "authToken" || event.key === null)) {
        studentHubLauncher.authTokenChanged(localUserStore.getAuthToken());
    }
}
// eslint-disable-next-line listeners/no-missing-remove-event-listener
window.addEventListener("storage", onStorage);
