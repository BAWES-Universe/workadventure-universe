<script lang="ts">
    import { onDestroy } from "svelte";
    import LL from "../../../i18n/i18n-svelte";
    import { popupStore } from "../../Stores/PopupStore";
    import { helpNotificationSettingsVisibleStore } from "../../Stores/HelpSettingsStore";
    import { installApp } from "../../Install/InstallWiring";
    import { currentInstallEnvironment } from "../../Install/InstallPlatform";
    import type { NotificationMoment } from "./NotificationAsk";
    import { NOTIFICATION_CARD_ID } from "./NotificationAsk";
    import { blockedSteps, cardStartState, type CardState } from "./NotificationCardState";
    import { describeDevice, pushAvailability, turnOnThisDevice, BROWSER_NAMES } from "./PushDevice";
    import { IconBell, IconBellOff, IconCheck, IconShare2, IconX } from "@wa-icons";

    /**
     * The card that offers notifications at a moment (#863): a plain white glyph, a title that names the notification,
     * a preview of the exact one, Not now and Turn on. Turn on opens the browser's own box from the tap; the card then
     * says what happened: on, blocked (with the steps to undo it), or nothing lost.
     */
    export let moment: NotificationMoment;

    const ON_CLOSES_AFTER_MS = 6000;
    const device = describeDevice(currentInstallEnvironment());
    const deviceWord =
        device.os === "iphone" ? "iPhone" : device.os === "ipad" ? "iPad" : $LL.notification.push.device[device.kind]();
    const browserName = BROWSER_NAMES[device.browser];
    const steps = blockedSteps(device);

    let state: CardState = cardStartState(
        pushAvailability(),
        "Notification" in window ? Notification.permission : undefined
    );
    let closeTimer: ReturnType<typeof setTimeout> | undefined;

    $: name = moment.kind === "busy" ? "" : moment.name;
    $: isBot = moment.kind === "reply" && moment.bot;
    $: words = $LL.notification.push;
    $: title =
        moment.kind === "busy"
            ? words.busy.title()
            : moment.kind === "friendRequest"
            ? words.friendRequest.title({ name })
            : words.reply.title({ name });
    $: body =
        moment.kind === "busy"
            ? words.busy.body({ device: deviceWord })
            : moment.kind === "friendRequest"
            ? words.friendRequest.body({ device: deviceWord })
            : isBot
            ? words.reply.botBody({ device: deviceWord, name })
            : words.reply.body({ device: deviceWord, name });
    $: preview =
        moment.kind === "busy"
            ? [words.busy.previewName(), words.busy.previewLine()]
            : moment.kind === "friendRequest"
            ? [name, words.friendRequest.previewLine()]
            : [name, isBot ? words.reply.botPreviewLine() : words.reply.previewLine()];
    $: onLine =
        moment.kind === "busy"
            ? words.busy.on()
            : moment.kind === "friendRequest"
            ? words.friendRequest.on({ name })
            : words.reply.on({ name });

    function close() {
        clearTimeout(closeTimer);
        popupStore.removePopup(NOTIFICATION_CARD_ID);
    }

    function turnOn() {
        state = "asking";
        // Straight from the tap: Safari and Firefox open their box only then.
        turnOnThisDevice()
            .then((result) => {
                if (result === "on") {
                    helpNotificationSettingsVisibleStore.set(false);
                    state = "on";
                    closeTimer = setTimeout(close, ON_CLOSES_AFTER_MS);
                } else if (result === "blocked") {
                    state = "blocked";
                } else if (result === "failed") {
                    state = "failed";
                } else {
                    // The box was closed without an answer: nothing is lost, it can be asked again later.
                    close();
                }
            })
            .catch(() => (state = "failed"));
    }

    function addToHomeScreen() {
        close();
        installApp.install("menu").catch((error) => console.error(error));
    }

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") close();
    }

    onDestroy(() => clearTimeout(closeTimer));
</script>

<svelte:window on:keydown={onKeyDown} />

<div
    class="u-surface notification-card flex flex-col text-white rounded-2xl overflow-hidden z-20 w-full max-w-[380px] pointer-events-auto"
    role="dialog"
    aria-labelledby="notification-card-title"
    data-testid="notification-card"
>
    <div class="grid gap-3.5 p-[18px] pb-4 text-left">
        <div class="card-head grid items-start gap-2.5">
            <span class="pt-0.5 text-white" aria-hidden="true">
                {#if state === "on"}
                    <IconCheck font-size="22" />
                {:else if state === "blocked"}
                    <IconBellOff font-size="22" />
                {:else if state === "iphone"}
                    <!-- Safari's own Share glyph, the button the steps point to -->
                    <IconShare2 font-size="22" />
                {:else}
                    <IconBell font-size="22" />
                {/if}
            </span>
            <div class="grid gap-1 min-w-0">
                <h2 id="notification-card-title" class="card-title m-0 text-[17px] leading-[1.3] font-bold text-white">
                    {#if state === "on"}
                        {words.on.title({ device: deviceWord })}
                    {:else if state === "blocked"}
                        {words.blocked.title()}
                    {:else if state === "failed"}
                        {words.failed.title()}
                    {:else if state === "iphone"}
                        {words.iphone.title({ device: deviceWord })}
                    {:else}
                        {title}
                    {/if}
                </h2>
                <p class="m-0 text-sm leading-[1.45] text-white/75">
                    {#if state === "on"}
                        {onLine} {words.on.settings()}
                    {:else if state === "blocked"}
                        {device.installed
                            ? words.blocked.app()
                            : device.browser === "other"
                            ? words.blocked.bodyAnyBrowser()
                            : words.blocked.body({ browser: browserName })}
                    {:else if state === "failed"}
                        {words.failed.body({ device: deviceWord })}
                    {:else if state === "iphone"}
                        {words.iphone.body({ device: deviceWord })}
                    {:else}
                        {body}
                    {/if}
                </p>
            </div>
            <button
                type="button"
                class="close-button grid place-items-center h-11 w-11 border-0 bg-transparent text-white/60 hover:text-white rounded-full"
                aria-label={words.close()}
                on:click={close}
            >
                <IconX font-size="18" />
            </button>
        </div>

        {#if state === "ask" || state === "asking"}
            <div class="grid gap-1.5">
                <span class="text-[11px] tracking-[0.08em] uppercase text-white/50 font-semibold"
                    >{words.previewLabel()}</span
                >
                <div
                    class="preview grid items-center gap-2.5 px-3 py-2.5 rounded-[14px] bg-white/[0.06] border border-solid border-white/10"
                >
                    <!-- The BAWES lettermark, white, as in the approved mock -->
                    <svg class="justify-self-center" width="14" height="18" viewBox="0 0 332 432" aria-hidden="true">
                        <g fill="#fff" transform="translate(16 16)">
                            <path d="M0 0H194.34L97.17 97.17Z" />
                            <path d="M202.83 2.83L300 100L202.83 197.17L105.66 100Z" />
                            <path d="M97.17 102.83L297.17 302.83L202.83 397.17L2.83 197.17Z" />
                            <path d="M0 400L97.17 302.83L194.34 400Z" />
                        </g>
                    </svg>
                    <span class="grid gap-px min-w-0 text-left">
                        <span class="text-[11px] text-white/55">{words.previewApp()}</span>
                        <span class="text-sm font-bold text-white leading-tight truncate">{preview[0]}</span>
                        <span class="text-[13px] text-white/80 leading-snug">{preview[1]}</span>
                    </span>
                </div>
            </div>
        {/if}

        {#if state === "blocked"}
            <ol class="m-0 pl-5 grid gap-1.5 text-sm leading-[1.4] text-white/85 text-left">
                {#each steps as step (step)}
                    <li>{words.blocked.steps[step.group][step.key]()}</li>
                {/each}
            </ol>
        {/if}

        {#if state === "asking"}
            <div
                class="asking flex items-center gap-2.5 px-3 py-2.5 rounded-[14px] text-sm text-white text-left"
                role="status"
            >
                <span class="spinner h-[18px] w-[18px] rounded-full flex-none" aria-hidden="true" />
                <span>{words.asking()}</span>
            </div>
        {/if}

        {#if state === "ask"}
            <div class="flex gap-2">
                <button
                    type="button"
                    class="u-cta-secondary h-11 flex-1 min-w-0 m-0 px-4 rounded-full justify-center text-sm font-bold"
                    on:click={close}>{words.notNow()}</button
                >
                <button
                    type="button"
                    class="u-cta h-11 flex-1 min-w-0 m-0 px-4 rounded-full justify-center text-sm font-bold"
                    on:click={turnOn}
                    data-testid="notification-card-turn-on">{words.turnOn()}</button
                >
            </div>
        {:else if state === "on"}
            <div class="flex gap-2">
                <button
                    type="button"
                    class="u-cta h-11 flex-1 min-w-0 m-0 px-4 rounded-full justify-center text-sm font-bold"
                    on:click={close}>{words.done()}</button
                >
            </div>
        {:else if state === "iphone"}
            <div class="flex gap-2">
                <button
                    type="button"
                    class="u-cta-secondary h-11 flex-1 min-w-0 m-0 px-4 rounded-full justify-center text-sm font-bold"
                    on:click={close}>{words.notNow()}</button
                >
                <button
                    type="button"
                    class="u-cta h-11 flex-[1.5] min-w-0 m-0 px-4 rounded-full justify-center text-sm font-bold"
                    on:click={addToHomeScreen}>{words.iphone.addToHomeScreen()}</button
                >
            </div>
        {:else if state === "blocked" || state === "failed"}
            <div class="flex gap-2">
                <button
                    type="button"
                    class="u-cta-secondary h-11 flex-1 min-w-0 m-0 px-4 rounded-full justify-center text-sm font-bold"
                    on:click={close}>{words.close()}</button
                >
            </div>
        {/if}
    </div>
</div>

<style>
    .card-head {
        grid-template-columns: auto minmax(0, 1fr) 44px;
    }
    .card-title {
        font-family: inherit;
        text-transform: none;
        letter-spacing: 0;
    }
    .close-button {
        margin: -10px -10px 0 0;
    }
    .preview {
        grid-template-columns: 32px minmax(0, 1fr);
    }
    /* Picked, not go: the soft violet of the UI standard while the browser's own box is up. */
    .asking {
        background: rgba(134, 41, 252, 0.14);
        border: 1px solid rgba(167, 139, 250, 0.7);
    }
    .spinner {
        border: 2px solid rgba(255, 255, 255, 0.85);
        border-top-color: transparent;
        animation: notification-card-spin 0.9s linear infinite;
    }
    @keyframes notification-card-spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
