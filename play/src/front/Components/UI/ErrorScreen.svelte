<script lang="ts">
    import { fly } from "svelte/transition";
    import { onDestroy } from "svelte";
    import type { ErrorScreenMessage } from "@workadventure/messages";
    import { errorScreenStore } from "../../Stores/ErrorScreenStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { connectionManager } from "../../Connection/ConnectionManager";

    import reload from "../images/reload.png";
    // Orbit's butterfly (2.7 KB): the build puts files under 4 KB inside the script itself, so the reconnecting
    // screen shows it without the network.
    import butterfly from "../images/butterfly.webp";
    import LL from "../../../i18n/i18n-svelte";

    import LoaderIcon from "../Icons/LoaderIcon.svelte";
    import { reconnectingCopy } from "../../Connection/ReconnectScreen";
    import {
        NEW_VERSION_CODE,
        NEW_VERSION_COUNTDOWN_MS,
        canAutoReload,
        recordAutoReload,
    } from "../../Connection/NewVersionReload";

    // Everything below follows the screen currently in the store: it can change while this screen is up (the
    // "Reconnecting" screen becomes "New version" when the server that answers the reconnect is newer).
    $: errorScreen = $errorScreenStore;
    $: isNewVersion = errorScreen?.type === "retry" && errorScreen.code === NEW_VERSION_CODE;

    // The room's own logos (Universe's, from the admin); an empty value from the server means "none".
    $: logoErrorSrc = errorScreen?.imageLogo || gameManager?.currentStartedRoom?.loginSceneLogo || undefined;
    // The update screen shows the logo alone.
    $: imageErrorSrc = isNewVersion
        ? undefined
        : errorScreen?.image || gameManager?.currentStartedRoom?.errorSceneLogo || undefined;
    // A logo that fails to load shows the name instead; a failed image is left out.
    let failedLogoSrc: string | undefined;
    let failedImageSrc: string | undefined;
    // When the image is the same picture as the logo shown above it, show it only once, as the logo.
    $: logoShown = errorScreen?.type !== "reconnecting" && !!logoErrorSrc && logoErrorSrc !== failedLogoSrc;
    $: imageShown =
        !!imageErrorSrc && imageErrorSrc !== failedImageSrc && !(logoShown && imageErrorSrc === logoErrorSrc);

    function click() {
        if (errorScreen?.type === "unauthorized") void connectionManager.logout();
        else window.location.reload();
    }

    // Retry screens reload on their own when their countdown ends. The update screen counts down from ten seconds,
    // unless recent automatic reloads still landed on the old version: then it waits for Refresh.
    let countdownTimer: ReturnType<typeof setInterval> | undefined;
    let countdownTotal = 0;
    let remainingMs = 0;
    let autoReloading = false;

    function startCountdown(screen: ErrorScreenMessage | undefined) {
        clearInterval(countdownTimer);
        countdownTimer = undefined;
        autoReloading = false;
        if (screen?.type !== "retry") return;
        const newVersion = screen.code === NEW_VERSION_CODE;
        if (newVersion && !canAutoReload()) return;
        countdownTotal = newVersion ? NEW_VERSION_COUNTDOWN_MS : screen.timeToRetry ?? 0;
        remainingMs = countdownTotal;
        autoReloading = true;
        const deadline = Date.now() + countdownTotal;
        countdownTimer = setInterval(() => {
            remainingMs = Math.max(0, deadline - Date.now());
            if (remainingMs > 0) return;
            clearInterval(countdownTimer);
            countdownTimer = undefined;
            if (newVersion) recordAutoReload();
            window.location.reload();
        }, 250);
    }
    $: startCountdown(errorScreen);
    onDestroy(() => clearInterval(countdownTimer));

    $: secondsLeft = Math.ceil(remainingMs / 1000);
    // The ring empties as the countdown runs.
    const RING_RADIUS = 20;
    const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
    $: ringOffset = countdownTotal > 0 ? RING_LENGTH * (1 - remainingMs / countdownTotal) : 0;

    function getBackgroundColor() {
        if (!gameManager.currentStartedRoom) return undefined;
        return gameManager.currentStartedRoom.backgroundColor;
    }

    $: detailsStylized = (errorScreen?.details ?? "").replace("{time}", `${secondsLeft}`);

    // Still reconnecting after a while with no network: say the device is offline (it keeps retrying on its own).
    let online = navigator.onLine;
    let now = Date.now();
    let reconnectingSince: number | undefined;
    $: if ($errorScreenStore?.type === "reconnecting") {
        if (reconnectingSince === undefined) reconnectingSince = Date.now();
    } else {
        reconnectingSince = undefined;
    }
    $: offline = reconnectingSince !== undefined && reconnectingCopy(now - reconnectingSince, online) === "offline";

    const clock = setInterval(() => (now = Date.now()), 1000);
    const onOnline = () => (online = true);
    const onOffline = () => (online = false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    onDestroy(() => {
        clearInterval(clock);
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
    });
</script>

{#if $errorScreenStore}
    <main
        class="errorScreen bg-contrast h-dvh pointer-events-auto w-full text-white text-center absolute flex flex-wrap items-center justify-center h-full top-0 left-0 right-0 mx-auto overflow-scroll py-5"
        style={getBackgroundColor() != undefined ? `background-color: ${getBackgroundColor()};` : ""}
        transition:fly={{ y: -200, duration: 500 }}
    >
        <div class="flex flex-col items-center" style=" width: 90%;">
            <div class="logo">
                {#if $errorScreenStore.type !== "reconnecting"}
                    {#if logoShown}
                        <img
                            src={logoErrorSrc}
                            on:error={() => (failedLogoSrc = logoErrorSrc)}
                            alt="Logo error"
                            style="max-height:25vh; max-width:80%;"
                            draggable="false"
                        />
                    {:else}
                        <p class="wordmark">Universe</p>
                    {/if}
                {/if}
            </div>

            {#if imageShown}
                <div class="icon" class:reconnecting={$errorScreenStore.type === "reconnecting"}>
                    <img
                        src={imageErrorSrc}
                        alt="Error"
                        style="max-width:100%;"
                        draggable="false"
                        on:error={() => (failedImageSrc = imageErrorSrc)}
                    />
                </div>
            {/if}
            {#if isNewVersion}
                <!-- The update screen: a title, one line with the countdown, and one button. -->
                <div class="newVersion flex flex-col items-center gap-6" data-testid="newVersionScreen">
                    <h2>{$LL.warning.newVersion.title()}</h2>
                    <div class="flex flex-row items-center justify-center gap-3">
                        {#if autoReloading}
                            <svg class="ring" viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
                                <circle class="ring-track" cx="24" cy="24" r={RING_RADIUS} />
                                <circle
                                    class="ring-progress"
                                    cx="24"
                                    cy="24"
                                    r={RING_RADIUS}
                                    stroke-dasharray={RING_LENGTH}
                                    stroke-dashoffset={ringOffset}
                                />
                                <text x="24" y="24" dominant-baseline="central" text-anchor="middle">{secondsLeft}</text
                                >
                            </svg>
                            <p class="lead" data-testid="newVersionDetails">
                                {$LL.warning.newVersion.countdown({ seconds: secondsLeft })}
                            </p>
                        {:else}
                            <p class="lead" data-testid="newVersionDetails">{$LL.warning.newVersion.manual()}</p>
                        {/if}
                    </div>
                    <button type="button" class="btn-lg btn btn-secondary button" on:click={click}>
                        {$LL.warning.newVersion.refreshNow()}
                    </button>
                </div>
            {:else}
                {#if $errorScreenStore.type !== "retry"}<h2 class="mt-10">
                        {offline ? $LL.warning.offlineTitle() : $errorScreenStore.title}
                    </h2>{/if}
                {#if $errorScreenStore.subtitle && !offline}<p>{$errorScreenStore.subtitle}</p>{/if}
                {#if $errorScreenStore.type !== "retry" && $errorScreenStore.type !== "reconnecting"}<p class="code">
                        Code : {$errorScreenStore.code}
                    </p>{/if}
                {#if $errorScreenStore.type === "reconnecting"}
                    <!-- The text, then the spinner under it: both centred. -->
                    <div
                        class="details flex flex-col items-center justify-center gap-3"
                        data-testid="reconnectingDetails"
                    >
                        {#if offline}
                            <span>{$LL.warning.offlineDetails()}</span>
                        {:else if detailsStylized}
                            <span>{detailsStylized}</span>
                        {/if}
                        <!-- Orbit's butterfly over the rings, so they pulse out from it. -->
                        <span class="pulse" aria-hidden="true">
                            <LoaderIcon size="128" />
                            <img class="butterfly" src={butterfly} alt="" width="32" height="32" draggable="false" />
                        </span>
                    </div>
                {:else}
                    <p class="details flex flex-row items-center justify-center content-center gap-2">
                        <span>{detailsStylized}</span>
                        {#if $errorScreenStore.type === "retry"}
                            <div class="loading" />
                        {/if}
                    </p>
                {/if}
                <div class="flex gap-2">
                    {#if ($errorScreenStore.type === "retry" && $errorScreenStore.canRetryManual) || $errorScreenStore.type === "unauthorized"}
                        <button type="button" class="btn-lg btn btn-light btn-border button" on:click={click}>
                            {#if $errorScreenStore.type === "retry"}<img
                                    src={reload}
                                    alt=""
                                    class="reload mr-2 hover:"
                                    draggable="false"
                                />{/if}
                            {$errorScreenStore.buttonTitle}
                        </button>
                    {/if}
                </div>
            {/if}
        </div>
    </main>
{/if}

<style lang="scss">
    main.errorScreen {
        .wordmark {
            font-size: 2.25rem;
            font-weight: 700;
            letter-spacing: 0.02em;
            margin: 0;
        }
        min-width: 300px;
        z-index: 700;
        .logo {
            margin: 0 auto 50px auto;
        }
        .icon {
            margin: 0 auto 25px auto;
            img {
                height: 125px;
            }
            // The reconnecting screen shows the logo alone: a little bigger, as close to the title as before.
            &.reconnecting {
                margin-bottom: -24px;
                img {
                    height: 160px;
                }
            }
        }
        .pulse {
            position: relative;
            display: grid;
            place-items: center;
            width: 128px;
            height: 128px;
            :global(svg) {
                position: absolute;
                inset: 0;
            }
        }
        .butterfly {
            position: relative;
            width: 32px;
            height: 32px;
            image-rendering: pixelated;
        }
        .newVersion {
            h2 {
                font-size: 28px;
                font-weight: 700;
                margin: 0;
            }
            p.lead {
                font-size: 16px;
                opacity: 0.8;
                margin: 0;
            }
            .ring {
                flex-shrink: 0;
                transform: rotate(-90deg);
                circle {
                    fill: none;
                    stroke-width: 4;
                }
                .ring-track {
                    stroke: rgba(255, 255, 255, 0.15);
                }
                .ring-progress {
                    stroke: currentColor;
                    stroke-linecap: round;
                    transition: stroke-dashoffset 250ms linear;
                }
                text {
                    fill: currentColor;
                    font-size: 16px;
                    font-weight: 700;
                    transform: rotate(90deg);
                    transform-origin: 24px 24px;
                }
            }
            .button {
                min-width: 180px;
            }
        }
        h2 {
            padding: 5px;
            font-size: 30px;
        }
        p.code {
            font-size: 12px;
            opacity: 0.6;
            user-select: text;
        }
        p.details,
        div.details {
            font-size: 12px;
            max-width: 80%;
            margin: 0 auto 35px auto;
        }
        div.details {
            font-size: 14px;
        }
        .loading {
            display: inline-block;
            min-width: 20px;
            position: relative;
            margin-left: 5px;
        }
        .loading:after {
            overflow: hidden;
            display: inline-block;
            vertical-align: bottom;
            -webkit-animation: ellipsis steps(4, end) 900ms infinite;
            animation: ellipsis steps(4, end) 900ms infinite;
            content: "\2026";
            width: 0;
            font-family: "Press Start 2P";
            font-size: 16px;
            position: absolute;
            left: 0;
            top: -19px;
        }

        @keyframes ellipsis {
            to {
                width: 1.25em;
            }
        }

        @-webkit-keyframes ellipsis {
            to {
                width: 1.25em;
            }
        }

        .button {
            cursor: pointer;
            font-size: 14px;
            .reload {
                margin-top: -4px;
                width: 22px;
            }
        }
    }

    @media all and (max-device-width: 480px) {
        main.errorScreen {
            .logo {
                width: 90%;
                max-width: 90vw;
            }
            .icon:not(.reconnecting) {
                height: 60px;
            }
        }
    }
</style>
