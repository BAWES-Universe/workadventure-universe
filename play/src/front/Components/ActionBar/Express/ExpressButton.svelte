<script lang="ts">
    import { onDestroy } from "svelte";
    import { clickOutside } from "svelte-outside";
    import { chatVisibilityStore } from "../../../Stores/ChatStore";
    import { hideActionBarStoreBecauseOfChatBar } from "../../../Chat/ChatSidebarWidthStore";
    import { highlightFullScreen } from "../../../Stores/ActionsCamStore";
    import { mapEditorModeStore } from "../../../Stores/MapEditorStore";
    import { emoteDataStore, emotePlayedStore } from "../../../Stores/EmoteStore";
    import { expressTrayStore } from "../../../Stores/ExpressStore";
    import { connectionManager } from "../../../Connection/ConnectionManager";
    import { longpress } from "../../../Utils/longpress";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import LL from "../../../../i18n/i18n-svelte";
    import type { ExpressSent } from "./ExpressTray.svelte";
    import ExpressTray from "./ExpressTray.svelte";

    // Same source as the action bar's emoji menu; never throws while a scene is loading.
    const sayEnabled = connectionManager.currentRoom?.isSayEnabled ?? true;

    let button: HTMLButtonElement;

    // Hidden whenever the chat panel is open, the action bar is hidden, a video is full screen,
    // or the map editor is in use.
    $: visible =
        !$chatVisibilityStore && !$hideActionBarStoreBecauseOfChatBar && !$highlightFullScreen && !$mapEditorModeStore;
    // The tray only shows while the button does, whatever the store says.
    $: open = visible && $expressTrayStore !== "closed";
    // Close the store once the button hides. Deferred to after this update: setting the store while Svelte is
    // computing reactive values left `open` stale at true, so after the map editor (which hides the button)
    // the tray came back and could no longer be closed.
    $: if (!visible && $expressTrayStore !== "closed") {
        queueMicrotask(() => expressTrayStore.close());
    }
    $: faceEmoji = $emoteDataStore.get(1)?.emoji ?? "👍";

    type Burst = { id: number; glyph: string };
    let bursts: Burst[] = [];
    let burstId = 0;
    let pulse = false;

    function toggle() {
        if (open) {
            expressTrayStore.close();
            return;
        }
        expressTrayStore.open();
        analyticsClient.expressTrayOpened("tap");
    }

    /** Long-press (touch) or right-click (mouse): straight to edit mode. For advanced users; a tap never lands here. */
    function openEditing() {
        try {
            navigator.vibrate?.(12);
        } catch {
            // Not supported: no haptics.
        }
        const wasClosed = !open;
        expressTrayStore.edit();
        // Only count a closed-to-open transition, not a switch into edit mode.
        if (wasClosed) {
            analyticsClient.expressTrayOpened("edit");
        }
    }

    function onClickOutside(event: Event) {
        if (!open) return;
        // The emoji picker of edit mode floats outside the tray: picking an emoji isn't a click outside.
        if (event.composedPath().some((el) => el instanceof HTMLElement && el.tagName === "EMOJI-PICKER")) return;
        expressTrayStore.close();
    }

    function burst(glyph: string) {
        const id = ++burstId;
        bursts = [...bursts, { id, glyph }];
        setTimeout(() => (bursts = bursts.filter((b) => b.id !== id)), 900);
        pulse = false;
        requestAnimationFrame(() => (pulse = true));
    }

    // Emotes played with the number keys (or elsewhere) get the same feedback as a tap in the tray.
    // The tray's own plays already burst through onTrayClose.
    const mountedAt = Date.now();
    const unsubscribeEmotePlayed = emotePlayedStore.subscribe((played) => {
        // Skip the value already in the store when the button mounts: only react to new plays.
        if (!played || played.at < mountedAt || played.source === "express_tray" || !visible) return;
        burst(played.emoji);
    });
    onDestroy(unsubscribeEmotePlayed);

    function onTrayClose(event: CustomEvent<{ sent?: ExpressSent }>) {
        expressTrayStore.close();
        const sent = event.detail.sent;
        if (sent) {
            burst(sent.kind === "emote" ? sent.emoji : sent.kind === "say" ? "💬" : "💭");
        } else {
            button?.focus({ preventScroll: true });
        }
    }
</script>

{#if visible}
    <div class="relative pointer-events-auto" data-testid="express" use:clickOutside={onClickOutside}>
        {#if open}
            <ExpressTray {sayEnabled} on:close={onTrayClose} />
        {/if}

        <button
            bind:this={button}
            type="button"
            class="express-button relative m-0 flex h-16 w-16 items-center justify-center rounded-lg p-0"
            class:is-open={open}
            class:pulse
            aria-label={open ? $LL.say.express.close() : $LL.say.express.button()}
            aria-expanded={open}
            aria-haspopup="dialog"
            title={open ? undefined : $LL.say.express.button()}
            data-testid="express-button"
            use:longpress={openEditing}
            on:click|stopPropagation={toggle}
            on:animationend={() => (pulse = false)}
        >
            <span class="express-halo" aria-hidden="true" />
            <span class="express-face text-[1.9rem] leading-none" aria-hidden="true">{faceEmoji}</span>
            <span class="express-close" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2"
                    ><path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" /></svg
                >
            </span>
        </button>

        {#each bursts as burst (burst.id)}
            <span
                class="express-burst pointer-events-none absolute inset-x-0 top-0 text-center text-3xl"
                aria-hidden="true">{burst.glyph}</span
            >
        {/each}
    </div>
{/if}

<style lang="scss">
    .express-button {
        -webkit-touch-callout: none;
        -webkit-user-select: none;
        user-select: none;
        background: rgba(27, 42, 65, 0.8);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        cursor: pointer;
        isolation: isolate;
        transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1), background 150ms ease;
        -webkit-tap-highlight-color: transparent;
    }
    .express-button:hover {
        background: rgba(27, 42, 65, 0.95);
    }
    .express-button:active {
        transform: scale(0.9);
    }
    .express-button:focus-visible {
        outline: 2px solid #8629fc;
        outline-offset: 2px;
    }

    /* A slow, soft aurora around the edge: it's alive, not flashing. */
    .express-halo {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        padding: 1.5px;
        background: conic-gradient(from var(--angle, 0deg), #8629fc, #4156f6, #e9c74c, #8629fc);
        -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
        mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
        opacity: 0.55;
        animation: halo-spin 6s linear infinite;
        z-index: -1;
        transition: opacity 200ms ease;
    }
    .express-button:hover .express-halo,
    .express-button.is-open .express-halo {
        opacity: 1;
    }

    @property --angle {
        syntax: "<angle>";
        initial-value: 0deg;
        inherits: false;
    }
    @keyframes halo-spin {
        to {
            --angle: 360deg;
        }
    }

    .express-face,
    .express-close {
        position: absolute;
        transition: transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 180ms ease;
    }
    .express-face {
        filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.35));
    }
    .express-button:hover .express-face {
        transform: rotate(-8deg) scale(1.08);
    }
    .express-close {
        color: white;
        opacity: 0;
        transform: rotate(-90deg) scale(0.5);
    }
    .express-button.is-open .express-face {
        opacity: 0;
        transform: rotate(90deg) scale(0.4);
    }
    .express-button.is-open .express-close {
        opacity: 1;
        transform: none;
    }

    .express-button.pulse {
        animation: sent-pulse 420ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    @keyframes sent-pulse {
        0% {
            transform: scale(0.88);
        }
        60% {
            transform: scale(1.08);
        }
        100% {
            transform: scale(1);
        }
    }

    .express-burst {
        animation: burst-rise 900ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
        filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.4));
    }
    @keyframes burst-rise {
        0% {
            opacity: 0;
            transform: translateY(8px) scale(0.6);
        }
        20% {
            opacity: 1;
            transform: translateY(-14px) scale(1.25);
        }
        100% {
            opacity: 0;
            transform: translateY(-72px) scale(0.9) rotate(-10deg);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .express-halo,
        .express-button.pulse,
        .express-burst {
            animation: none;
        }
        .express-burst {
            display: none;
        }
    }
</style>
