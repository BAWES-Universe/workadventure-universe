import { get, readable } from "svelte/store";
import { botApiService } from "../external-modules/bots/services/BotApiService";
import { modalIframeStore, modalVisibilityStore } from "./ModalStore";

/** How often the count is asked again while the game is open and in view. */
const REFRESH_MS = 2 * 60 * 1000;
/** Until Orbit first answers (the player is still signing in), it is asked sooner. */
const FIRST_TRY_MS = 15 * 1000;

/**
 * How many things in Orbit wait for this player's answer (pending invitations for now), for the count on the Orbit
 * button. Like Orbit's own count on You, it goes down only when something is answered or dismissed, never just for
 * being seen. Asked when the bar shows, every two minutes while the tab is in view, and as soon as Orbit closes, so
 * whatever was answered there shows at once. 0 when unknown.
 */
export const orbitAttentionCountStore = readable(0, (set) => {
    let stopped = false;
    let answered = false;
    let latest = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(load, answered ? REFRESH_MS : FIRST_TRY_MS);
    };
    function load() {
        if (stopped) return;
        if (document.visibilityState === "hidden") return schedule();
        const request = ++latest;
        botApiService
            .getAttentionCount()
            .then((count) => {
                if (stopped || request !== latest) return;
                if (count !== null) {
                    answered = true;
                    set(count);
                }
                schedule();
            })
            .catch(() => schedule());
    }

    let orbitWasOpen = false;
    const unsubscribeModal = modalVisibilityStore.subscribe((visible) => {
        const orbitOpen = visible && get(modalIframeStore)?.title === "Orbit";
        if (orbitWasOpen && !orbitOpen) load();
        orbitWasOpen = orbitOpen;
    });
    const onVisible = () => {
        if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    load();

    return () => {
        stopped = true;
        clearTimeout(timer);
        unsubscribeModal();
        document.removeEventListener("visibilitychange", onVisible);
    };
});
