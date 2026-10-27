<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import { fade } from "svelte/transition";
    import type { Unsubscriber } from "svelte/store";
    import { derived, readable } from "svelte/store";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { gameSceneIsLoadedStore } from "../../Stores/GameSceneStore";
    import {
        adminDashboardActivatedStore,
        activeSubMenuStore,
        inviteUserActivated,
        menuVisiblilityStore,
    } from "../../Stores/MenuStore";
    import { modalIframeStore, modalVisibilityStore } from "../../Stores/ModalStore";
    import { mapExplorationModeStore } from "../../Stores/MapEditorStore";
    import { bubbleMatesStore } from "../../Stores/CurrentPlayerGroupStore";
    import { chatVisibilityStore } from "../../Stores/ChatStore";
    import { navChat } from "../../Chat/Stores/ChatStore";
    import { openChat } from "../../Chat/openChat";
    import InviteCard from "../../Chat/Components/InviteCard.svelte";
    import ImageWithFallback from "../../Chat/Components/UserList/ImageWithFallback.svelte";
    import { defaultColor, defaultWoka } from "../../Chat/Connection/Matrix/MatrixChatConnection";
    import type { ChatUser } from "../../Chat/Connection/ChatConnection";
    import { openAdminModalFromMenu } from "../../external-modules/admin-api/index";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import { titleBarGeometryStore } from "../../TitleBar/WindowControlsOverlay";
    import type { FitLevel } from "../../TitleBar/TitleBarFit";
    import { formatConversationTime, pickFitLevel } from "../../TitleBar/TitleBarFit";
    import { countPeopleAndBots } from "../../Chat/UserProvider/WorldUserProvider";
    import { IconArrowsMaximize, IconUserPlus } from "@wa-icons";

    /**
     * Universe's own title bar, in the installed computer app (#1019). Chrome and Edge give the app the strip where
     * they draw their grey bar and keep only their window buttons at the far end. It shows only then (see
     * WindowControlsOverlay.ts); phones, the iPhone app, browser tabs and full screen never get it.
     *
     * Left: the Universe mark, the room (opens Orbit), "N here" with a few faces (opens the People tab), and a chip
     * while you are in a conversation or looking around. Right, drawn like Chrome's own title-bar buttons (icon and
     * words, no pill): "Invite someone to join" (the same card as chat's) and "Full screen". The empty space drags
     * the window; everything you can press does not.
     */
    const FACES_SHOWN = 3;

    // The strip is the colour Chrome paints behind its own buttons (the manifest's theme_color, also the page's
    // theme-color), so no seam shows between them.
    const stripColor = document.querySelector('meta[name="theme-color"]')?.getAttribute("content") || "#14121E";

    interface SceneInfo {
        roomName: string | undefined;
        here: { count: number; people: number; bots: number; faces: ChatUser[] } | undefined;
    }

    // The room's name, and who is in it: the same list as the People tab, so "3 people · 2 bots" and the tab's room row
    // always agree.
    const sceneInfo = readable<SceneInfo>({ roomName: undefined, here: undefined }, (set) => {
        let stopUsers: Unsubscriber | undefined;
        let generation = 0;
        const stopScene = gameSceneIsLoadedStore.subscribe((loaded) => {
            const mine = ++generation;
            stopUsers?.();
            stopUsers = undefined;
            set({ roomName: undefined, here: undefined });
            const scene = loaded ? gameManager.tryGetCurrentGameScene() : undefined;
            if (!scene) return;
            const roomName = scene.room.roomName?.trim() || undefined;
            set({ roomName, here: undefined });
            if (!scene.room.isChatOnlineListEnabled) return;
            scene.userProviderMerger
                .then((merger) => {
                    if (mine !== generation) return;
                    stopUsers = merger.usersByRoomStore.subscribe((byRoom) => {
                        const users = byRoom.get(scene.roomUrl)?.users ?? [];
                        set({
                            roomName,
                            here: {
                                count: users.length,
                                ...countPeopleAndBots(users),
                                faces: users.filter((user) => !user.isBot).slice(0, FACES_SHOWN),
                            },
                        });
                    });
                })
                .catch((error: unknown) => console.error("Could not read who is in the room", error));
        });
        return () => {
            generation++;
            stopUsers?.();
            stopScene();
        };
    });

    $: roomName = $sceneInfo.roomName;
    $: here = $sceneInfo.here && $sceneInfo.here.count > 0 ? $sceneInfo.here : undefined;
    // "6 people · 21 bots" (#1389); the bots part is left out when there are none, or when the strip is short of room.
    $: herePeople = here ? $LL.chat.peopleTab.countPeople({ count: here.people }) : "";
    $: hereBots = here && here.bots > 0 ? $LL.chat.peopleTab.countBots({ count: here.bots }) : "";
    // Their Wokas, as pictures (each face keeps its own store, so the row listens to all of them).
    $: facePictures = derived(
        (here?.faces ?? []).map((face) => face.pictureStore ?? readable<string | undefined>(undefined)),
        (pictures) => pictures
    );

    // In a conversation: with someone in your bubble, counting from the moment it began (people joining or leaving
    // it do not restart the count).
    const inConversationStore = derived(bubbleMatesStore, ($mates) => $mates.length > 0);
    const conversationTimeStore = derived<typeof inConversationStore, string | undefined>(
        inConversationStore,
        ($inConversation, set) => {
            if (!$inConversation) {
                set(undefined);
                return;
            }
            const startedAt = Date.now();
            set(formatConversationTime(0));
            const ticker = setInterval(() => set(formatConversationTime((Date.now() - startedAt) / 1000)), 1000);
            return () => clearInterval(ticker);
        },
        undefined
    );
    $: inConversation = $inConversationStore;
    $: conversationTime = $conversationTimeStore;

    // The room opens Orbit. Only the Orbit button of the bar (OrbitMenuItem.svelte) shows Orbit is open and closes it,
    // so the room never looks pressed and pressing it again leaves Orbit open.
    function openOrbit() {
        if ($modalVisibilityStore && $modalIframeStore?.title === "Orbit") return;
        openAdminModalFromMenu();
    }

    // "N here" opens the chat on its People tab, like the People button of the bar (UserListMenuItem.svelte).
    function openPeople() {
        if (!$chatVisibilityStore) {
            menuVisiblilityStore.set(false);
            activeSubMenuStore.activateByIndex(0);
        }
        navChat.switchToUserList();
        openChat("button");
    }

    // Full screen, as Settings, Full screen does it. The strip steps aside while it lasts (WindowControlsOverlay.ts).
    const canFullscreen = document.fullscreenEnabled === true;
    let startedFullscreen = false;
    function goFullscreen() {
        analyticsClient.settingFullscreen("true");
        document.documentElement
            .requestFullscreen()
            .then(() => {
                startedFullscreen = true;
                localUserStore.setFullscreen(true);
            })
            .catch((error: unknown) => console.error(error));
    }
    function onFullscreenChange() {
        if (!document.fullscreenElement && startedFullscreen) {
            startedFullscreen = false;
            localUserStore.setFullscreen(false);
        }
    }

    // The invite card opens under its button.
    let inviteOpen = false;
    let inviteButton: HTMLButtonElement | undefined;
    let invitePopover: HTMLDivElement | undefined;
    let popoverEdge = 0;
    function toggleInvite() {
        if (!inviteOpen && inviteButton) {
            const rect = inviteButton.getBoundingClientRect();
            // The card's edge lines up with the button's far edge, so it stays under it in either reading direction.
            popoverEdge = document.documentElement.dir === "rtl" ? rect.left : window.innerWidth - rect.right;
        }
        inviteOpen = !inviteOpen;
    }
    $: if (!$titleBarGeometryStore || !$inviteUserActivated) inviteOpen = false;
    function onWindowClick(event: MouseEvent) {
        if (!inviteOpen || !(event.target instanceof Node)) return;
        if (invitePopover?.contains(event.target) || inviteButton?.contains(event.target)) return;
        inviteOpen = false;
    }
    // Capture phase: on window, stopPropagation in the bubble phase would not stop the Modal / Menu window listeners,
    // so Escape would close those as well as the card.
    function onWindowKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape" && inviteOpen) {
            event.stopPropagation();
            inviteOpen = false;
        }
    }

    // Words drop only when they do not fit: the bots count goes first, so the room name stays whole as long as it can;
    // then the room name shortens (CSS), then the two buttons become icons, last the faces go (TitleBarFit.ts).
    /** The room name stops shortening at this width (a short name is never padded out to it). */
    const ROOM_MIN_WIDTH = 80;
    const ROOM_PADDING = 14;
    let roomNaturalWidth = 0;
    $: roomMinWidth = Math.min(ROOM_MIN_WIDTH, roomNaturalWidth + ROOM_PADDING);
    let level: FitLevel = 0;
    let row: HTMLDivElement | undefined;
    let left: HTMLDivElement | undefined;
    let roomText: HTMLSpanElement | undefined;
    let fitRun = 0;

    function overflows(): boolean {
        // Svelte sets a bound element to null (not undefined) when the strip goes away mid-measure.
        return !!left && left.scrollWidth > left.clientWidth + 1;
    }

    // The room name shows "…" (it is cut).
    function roomCut(): boolean {
        return !!roomText && roomText.scrollWidth > roomText.clientWidth + 1;
    }

    // Always starts from the full layout, so a window that grew gets its words back. A newer call replaces one that
    // is still measuring; each step waits for the screen to update, so nothing in between is ever drawn.
    async function fit() {
        const run = ++fitRun;
        await tick();
        if (run !== fitRun) return;
        const picked = await pickFitLevel(async (candidate) => {
            if (run !== fitRun) return true;
            level = candidate;
            await tick();
            // The full layout also needs the room name whole: the bots count gives way before the name does.
            return !overflows() && (candidate > 0 || !roomCut());
        });
        if (run === fitRun) level = picked;
    }

    // Whatever changes what the strip holds or how much room it has asks for a new fit.
    $: if (row) {
        void [
            $titleBarGeometryStore?.width,
            roomName,
            here?.people,
            here?.bots,
            inConversation,
            $mapExplorationModeStore,
        ];
        void [$inviteUserActivated, $adminDashboardActivatedStore, canFullscreen, $LL, roomMinWidth];
        fit().catch((error: unknown) => console.error(error));
    }

    // The window being resized changes the room the strip has.
    function observeSize(node: HTMLElement) {
        const observer = new ResizeObserver(() => {
            fit().catch((error: unknown) => console.error(error));
        });
        observer.observe(node);
        return { destroy: () => observer.disconnect() };
    }

    onMount(() => document.addEventListener("fullscreenchange", onFullscreenChange));
    onDestroy(() => document.removeEventListener("fullscreenchange", onFullscreenChange));
</script>

<svelte:window on:click={onWindowClick} on:keydown|capture={onWindowKeyDown} />

{#if $titleBarGeometryStore}
    <div
        class="u-title-bar"
        style="--u-title-bar-bg: {stripColor}; height: {$titleBarGeometryStore.height}px;"
        data-testid="titleBar"
    >
        <div
            class="u-title-bar-row"
            style="left: {$titleBarGeometryStore.x}px; width: {$titleBarGeometryStore.width}px;"
            bind:this={row}
            use:observeSize
        >
            {#if roomName}
                <!-- The name at its full length, unseen, to know how short it may get. -->
                <span class="u-title-bar-measure" aria-hidden="true" bind:clientWidth={roomNaturalWidth}>
                    {roomName}
                </span>
            {/if}
            <div class="u-title-bar-left" bind:this={left}>
                <span class="u-title-bar-mark" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="38.5 41.5 47 64" aria-hidden="true">
                        <g transform="matrix(0.451368862 0 0 0.451503626 32.130258208 14.908490264)">
                            <path fill="#826625" d="M49.06 96.06L13 60H83.15L49.06 96.06Z" />
                            <path fill="#4D3A16" d="M83.16 130.16L48.08 95.08L83.16 60L118.23 95.08L83.16 130.16Z" />
                            <path fill="#F47026" d="M13.03 200.3L50.09 163.24L83.19 200.3H13.03Z" />
                            <path
                                fill="#EE2528"
                                d="M118.23 165.23L83.16 130.16V130.16L48.08 95.08L13.01 130.16L48.08 165.24L83.15 200.3L118.23 165.23Z"
                            />
                        </g>
                    </svg>
                </span>

                {#if roomName}
                    {#if $adminDashboardActivatedStore}
                        <button
                            type="button"
                            class="u-title-bar-item u-title-bar-room"
                            style:min-width="{roomMinWidth}px"
                            aria-label={$LL.titleBar.roomLabel({ room: roomName })}
                            data-testid="titleBarRoom"
                            on:click={openOrbit}
                        >
                            <span class="u-title-bar-ellipsis" bind:this={roomText}>{roomName}</span>
                        </button>
                    {:else}
                        <span class="u-title-bar-room u-title-bar-plain" style:min-width="{roomMinWidth}px">
                            <span class="u-title-bar-ellipsis" bind:this={roomText}>{roomName}</span>
                        </span>
                    {/if}
                {/if}

                {#if here}
                    <button
                        type="button"
                        class="u-title-bar-item u-title-bar-here"
                        aria-label={hereBots
                            ? $LL.titleBar.hereWithBotsLabel({ people: herePeople, bots: hereBots })
                            : $LL.titleBar.hereLabel({ people: herePeople })}
                        data-testid="titleBarHere"
                        on:click={openPeople}
                    >
                        {#if level < 3 && here.faces.length > 0}
                            <span class="u-title-bar-faces" aria-hidden="true">
                                {#each here.faces as face, index (face.spaceUserId ?? face.chatId)}
                                    <span
                                        class="u-title-bar-face"
                                        style="background-color: {face.color ?? defaultColor}"
                                    >
                                        <ImageWithFallback
                                            classes="u-title-bar-face-img"
                                            src={$facePictures[index]}
                                            alt=""
                                            fallback={defaultWoka}
                                        />
                                    </span>
                                {/each}
                            </span>
                        {/if}
                        <span>{level < 1 && hereBots ? `${herePeople} · ${hereBots}` : herePeople}</span>
                    </button>
                {/if}

                {#if inConversation}
                    <span
                        class="u-title-bar-chip u-title-bar-live"
                        data-testid="titleBarConversation"
                        in:fade={{ duration: 120 }}
                    >
                        <span class="u-title-bar-pulse" aria-hidden="true" />
                        {$LL.titleBar.inConversation()}
                        <span class="u-title-bar-time">{conversationTime}</span>
                    </span>
                {/if}
                {#if $mapExplorationModeStore}
                    <span
                        class="u-title-bar-chip u-title-bar-looking"
                        data-testid="titleBarLookAround"
                        in:fade={{ duration: 120 }}
                    >
                        {$LL.titleBar.lookingAround()}
                    </span>
                {/if}
            </div>

            <div class="u-title-bar-drag" />

            <div class="u-title-bar-right">
                {#if $inviteUserActivated}
                    <button
                        type="button"
                        class="u-title-bar-item u-title-bar-action"
                        class:u-title-bar-on={inviteOpen}
                        class:u-title-bar-icon-only={level >= 2}
                        aria-expanded={inviteOpen}
                        aria-label={$LL.chat.inviteFooter.button()}
                        title={level >= 2 ? $LL.chat.inviteFooter.button() : undefined}
                        data-testid="titleBarInvite"
                        bind:this={inviteButton}
                        on:click={toggleInvite}
                    >
                        <IconUserPlus font-size="16" class="shrink-0" />
                        {#if level < 2}<span>{$LL.chat.inviteFooter.button()}</span>{/if}
                    </button>
                {/if}
                {#if canFullscreen}
                    <button
                        type="button"
                        class="u-title-bar-item u-title-bar-action"
                        class:u-title-bar-icon-only={level >= 2}
                        aria-label={$LL.titleBar.fullScreen()}
                        title={level >= 2 ? $LL.titleBar.fullScreen() : undefined}
                        data-testid="titleBarFullscreen"
                        on:click={goFullscreen}
                    >
                        <IconArrowsMaximize font-size="16" class="shrink-0" />
                        {#if level < 2}<span>{$LL.titleBar.fullScreen()}</span>{/if}
                    </button>
                {/if}
            </div>
        </div>
    </div>

    {#if inviteOpen}
        <div
            class="u-title-bar-popover u-surface"
            style="top: {$titleBarGeometryStore.height + 5}px; inset-inline-end: {popoverEdge}px;"
            bind:this={invitePopover}
            transition:fade={{ duration: 120 }}
            data-testid="titleBarInviteCard"
        >
            <InviteCard titleId="titleBarInviteTitle" on:close={() => (inviteOpen = false)} />
        </div>
    {/if}
{/if}

<style lang="scss">
    /* The strip is outside <body> (see svelte.ts): the page itself starts below it. */
    :global(html.u-titlebar) {
        --u-dvh: calc(100dvh - var(--u-titlebar-h, 0px));
        background: #14121e;
    }
    /* The page below the strip. `contain: layout` makes it the box that fixed windows, popups and the chat are placed
       in, so every one of them starts under the strip and ends at the window's bottom. */
    :global(html.u-titlebar body) {
        position: fixed;
        inset: var(--u-titlebar-h, 0px) 0 0 0;
        /* Sized by the four edges above, not by the page's usual "100%". */
        width: auto;
        height: auto;
        contain: layout;
        /* `contain` stops the page's overflow: hidden from reaching the window, so the body is a box of its own, and
           a hidden box can still be scrolled by script: scrollIntoView() (pasting into the chat, jumping to a
           message) moved the whole game up under the strip. A clipped box cannot be scrolled at all. */
        overflow: clip;
    }

    .u-title-bar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 2147483000;
        box-sizing: border-box;
        background: var(--u-title-bar-bg);
        box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.07);
        color: #f4f2fa;
        font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 12.5px;
        font-weight: 600;
        line-height: 1;
        user-select: none;
        -webkit-user-select: none;
        /* The empty space moves the window and a double-click maximises it; what can be pressed does not. */
        -webkit-app-region: drag;
    }

    .u-title-bar-row {
        position: absolute;
        top: 0;
        bottom: 0;
        display: flex;
        align-items: center;
        min-width: 0;
        padding-inline: 10px 6px;
        box-sizing: border-box;
    }

    .u-title-bar-left {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
    }

    /* Always some room to grab the window by. */
    .u-title-bar-drag {
        flex: 1 1 24px;
        min-width: 24px;
        align-self: stretch;
    }

    .u-title-bar-right {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: none;
    }

    .u-title-bar-mark {
        display: flex;
        align-items: center;
        flex: none;
        padding-inline: 2px 6px;
        pointer-events: none;

        svg {
            height: 17px;
            width: auto;
            display: block;
        }
    }

    /* Everything that can be pressed: not part of the drag area. Plain icon and words, like Chrome's own buttons. */
    .u-title-bar-item {
        -webkit-app-region: no-drag;
        position: relative;
        display: flex;
        align-items: center;
        flex: none;
        margin: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        white-space: nowrap;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
    /* The bar's soft white hover: 8%, no shadow, blur or size change. */
    @media (hover: hover) {
        .u-title-bar-item:hover {
            background: rgba(255, 255, 255, 0.08);
        }
    }
    .u-title-bar-item:focus-visible {
        outline: 2px solid #fff;
        outline-offset: -2px;
    }

    .u-title-bar-room {
        flex: 0 1 auto;
        min-width: 0;
        height: 27px;
        padding-inline: 7px;
        border-radius: 6px;
        font-weight: 700;
    }
    .u-title-bar-room.u-title-bar-plain {
        display: flex;
        align-items: center;
    }
    .u-title-bar-measure {
        position: absolute;
        visibility: hidden;
        pointer-events: none;
        white-space: nowrap;
        font-weight: 700;
    }
    .u-title-bar-ellipsis {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .u-title-bar-here {
        height: 24px;
        gap: 6px;
        padding-inline: 9px;
        border-radius: 999px;
        color: #c9c4da;
    }
    .u-title-bar-faces {
        display: flex;
    }
    .u-title-bar-face {
        display: block;
        position: relative;
        width: 19px;
        height: 19px;
        flex: none;
        overflow: hidden;
        border-radius: 50%;
        box-shadow: 0 0 0 2px var(--u-title-bar-bg);
    }
    .u-title-bar-face + .u-title-bar-face {
        margin-inline-start: -6px;
    }
    /* The head of the Woka, as the People rows crop it. */
    .u-title-bar-face :global(.u-title-bar-face-img) {
        position: absolute;
        top: 2px;
        left: -2px;
        width: 23px;
        height: 23px;
        max-width: none;
        image-rendering: pixelated;
    }

    .u-title-bar-chip {
        display: flex;
        align-items: center;
        flex: none;
        gap: 6px;
        height: 24px;
        margin-inline-start: 4px;
        padding-inline: 9px;
        border-radius: 999px;
        white-space: nowrap;
        pointer-events: none;
    }
    .u-title-bar-live {
        background: rgba(61, 214, 140, 0.13);
        color: #9ef2c6;
    }
    .u-title-bar-time {
        color: #6fd7a3;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
    }
    .u-title-bar-pulse {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #3dd68c;
        box-shadow: 0 0 0 3px rgba(61, 214, 140, 0.25);
    }
    @media (prefers-reduced-motion: no-preference) {
        .u-title-bar-pulse {
            animation: u-title-bar-pulse 1.6s ease-in-out infinite;
        }
    }
    @keyframes u-title-bar-pulse {
        50% {
            box-shadow: 0 0 0 5px rgba(61, 214, 140, 0);
        }
    }
    .u-title-bar-looking {
        background: rgba(124, 92, 255, 0.22);
        color: #dcd3ff;
    }

    .u-title-bar-action {
        height: 29px;
        gap: 7px;
        padding-inline: 9px;
        border-radius: 6px;
    }
    .u-title-bar-action.u-title-bar-icon-only {
        width: 30px;
        padding: 0;
        justify-content: center;
    }
    .u-title-bar-action.u-title-bar-on {
        background: rgba(255, 255, 255, 0.1);
    }

    .u-title-bar-popover {
        position: fixed;
        z-index: 2147483001;
        box-sizing: border-box;
        width: min(340px, calc(100vw - 24px));
        padding: 6px;
        border-radius: 20px;
        color: #f4f2fa;
        font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
</style>
