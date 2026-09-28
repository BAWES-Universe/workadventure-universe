<script lang="ts">
    import { onDestroy, tick } from "svelte";
    import { fade, fly } from "svelte/transition";
    import { get } from "svelte/store";
    import { LL } from "../../../i18n/i18n-svelte";
    import { ENABLE_OPENID } from "../../Enum/EnvironmentVariable";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { userIsConnected } from "../../Stores/MenuStore";
    import { gameSceneStore } from "../../Stores/GameSceneStore";
    import { mapEditorModeStore } from "../../Stores/MapEditorStore";
    import { goToLogin } from "../../Components/ActionBar/MenuIcons/goToLogin";
    import { startQuestArrival } from "../QuestArrival";
    import {
        entryOrigin,
        logEntries,
        offerEyebrow,
        optionRows,
        questBody,
        questEyebrowFor,
        questObjective,
        questPayoffLine,
        stampName,
        whereDescription,
    } from "../QuestCopy";
    import {
        openQuestLog,
        profileMenuTrigger,
        requestQuestFocus,
        takeQuestFocus,
        takeQuestLogOpener,
    } from "../QuestDockFocus";
    import type { Point } from "../QuestGeometry";
    import { openQuestLogHistory } from "../QuestLogHistory";
    import { burstQuestMarker, startQuestMarkers } from "../QuestMarkers";
    import type { QuestPath, QuestState, QuestSurface, QuestVisibleSurface } from "../QuestModel";
    import { anyAccepted, doneCount, markedQuestPath, QUEST_PATHS } from "../QuestModel";
    import { motionMs } from "../QuestMotion";
    import { playChapterDone, playQuestDone } from "../QuestSound";
    import {
        acceptQuest,
        declineQuestInvitation,
        dispatchQuest,
        questAcceptedCountStore,
        questAnnouncementStore,
        questAvailablePathsStore,
        questDevice,
        questMeetProgressStore,
        questStateStore,
        questWorldStore,
        settleQuestCelebration,
        trackQuest,
    } from "../QuestStore";
    import { questVisibleSurfaceStore, startQuestSystem } from "../QuestSystem";
    import { playerFeet, questTarget, sceneQuestTarget, targetKey, targetPosition } from "../QuestTargets";
    import { questQuiet, questSurfaceSuppressed } from "../QuestUiStores";
    import {
        questUnreachableStore,
        questWalkingStore,
        resetQuestWalk,
        stopQuestWalk,
        walkToQuestTarget,
    } from "../QuestWalk";
    import { giverAsHost, offerHost, questGiverUserId } from "../QuestWorld";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { chatInputFocusStore } from "../../Stores/ChatStore";
    import { menuInputFocusStore } from "../../Stores/MenuInputFocusStore";
    import { inputFormFocusStore } from "../../Stores/UserInputStore";
    import QuestCard from "./QuestCard.svelte";
    import QuestCelebration from "./QuestCelebration.svelte";
    import QuestInvitation from "./QuestInvitation.svelte";
    import QuestMapMarks from "./QuestMapMarks.svelte";
    import QuestOptions from "./QuestOptions.svelte";
    import QuestPanel from "./QuestPanel.svelte";
    import QuestPill from "./QuestPill.svelte";

    /** A quest's celebration stays this long, counted only while it can be seen; the chapter's a little longer. */
    const CELEBRATION_MS = 3_200;
    const CHAPTER_CELEBRATION_MS = 4_500;
    const CELEBRATION_TICK_MS = 250;
    /** Each announcement stays in the status region this long, so it is read before the next one. */
    const ANNOUNCE_MS = 1_500;
    /** A card opened by taking a quest folds to the pill after this long of being seen... */
    export const CARD_FOLD_MS = 10_000;
    /** ...or on the player's first movement after this long, whichever comes first. */
    export const CARD_FOLD_MOVE_AFTER_MS = 3_000;
    const CARD_FOLD_TICK_MS = 250;
    const CARD_ID = "quest-card";
    const PANEL_ID = "quest-panel";

    let dock: HTMLElement | undefined;
    let layer: HTMLElement | undefined;
    let invitation: QuestInvitation | undefined;
    let options: QuestOptions | undefined;
    let card: QuestCard | undefined;
    let panel: QuestPanel | undefined;
    let pill: QuestPill | undefined;

    $: state = $questStateStore;
    $: world = $questWorldStore;
    $: visible = $questVisibleSurfaceStore;
    $: t = $LL;
    // The invitation and the options speak for the giver frozen when the offer was shown (its name stays as the
    // player walks out of the bot's range); a quest's card and celebration for the giver frozen at acceptance.
    $: eyebrow = offerEyebrow(t, state, world);
    $: offerPortrait = offerHost(state, world);
    $: tracked = state.tracked;
    $: objective = tracked ? questObjective(t, tracked, state, world) : "";
    $: cardEyebrow = tracked ? questEyebrowFor(t, tracked, state, world) : eyebrow;
    $: cardHost = tracked ? giverAsHost(entryOrigin(state, tracked, world).giver, world) : offerPortrait;
    $: trackedDone = !!tracked && state.quests[tracked].done;
    $: trackedBody = tracked ? questBody(t, tracked, state, world, $questMeetProgressStore) : "";

    // Walk: an area, or a person on this map; hidden once no path leads there.
    $: walkTarget = tracked ? questTarget(tracked, state, world) : undefined;
    $: walkLabel =
        tracked && walkTarget && !$questUnreachableStore.has(targetKey(walkTarget))
            ? tracked === "explore"
                ? t.quest.paths.explore.walk({ area: walkTarget.name })
                : t.quest.card.walkThere()
            : undefined;
    // Build: the editor opens from the card or the panel, where the person can edit.
    $: editorLabel = tracked === "build" && world.canBuild && !trackedDone ? t.quest.card.openEditor() : undefined;

    // The map marks: the tracked quest's target, always; the giver bot while it still has a quest to give.
    $: markedPath = markedQuestPath(state);
    $: giverMarkUserId = questGiverUserId(state, world, $questAvailablePathsStore);

    let whereText: string | undefined;

    // ---- System, arrival, markers, and what a map change resets ------------------------------------------------
    // Started with the component (not on mount) and stopped on destroy.
    const stops: Array<() => void> = [
        startQuestSystem(),
        startQuestArrival(),
        startQuestMarkers(),
        gameSceneStore.subscribe((scene) => {
            if (scene !== undefined) return;
            // A reconnect or a door: no walk carries over; the quest itself does.
            resetQuestWalk();
        }),
    ];
    onDestroy(() => {
        for (const stop of stops.splice(0).reverse()) stop();
        stopAnnouncing();
        stopCelebrationClock();
        stopAutoFold();
        // A reconnect or a room change closes the panel, as it closes the person card: Back must not land on a
        // panel that is no longer there.
        if (closeHistory) {
            const close = closeHistory;
            closeHistory = undefined;
            close();
            dispatchQuest({ type: "close" });
        }
    });

    // ---- Transitions: announcements, the card's fold, focus ------------------------------------------------------
    const initial = get(questStateStore);
    let previousSurface: QuestSurface = initial.surface;
    let previousVisible: QuestVisibleSurface = get(questVisibleSurfaceStore);
    let previousTracked: QuestPath | null = initial.tracked;
    let previousPaused = initial.quests.meet.paused;

    $: onStateChange(state);
    function onStateChange(current: QuestState) {
        if (current.tracked && current.tracked !== previousTracked) {
            questAnnouncementStore.push(
                t.quest.announce.tracking({ objective: questObjective(t, current.tracked, current, world) })
            );
        }
        if (current.surface === "card" && previousSurface !== "card") {
            // Opened by taking a quest (not from its pill): it folds by itself once it has been seen.
            if (previousSurface !== "pill") startAutoFold();
            announceWhere(current);
        } else if (current.surface !== "card") {
            stopAutoFold();
            if (previousSurface === "card") whereText = undefined;
        }
        const paused = current.quests.meet.paused;
        if (paused && !previousPaused && current.tracked === "meet")
            questAnnouncementStore.push(t.quest.card.nobodyHere());
        previousTracked = current.tracked;
        previousSurface = current.surface;
        previousPaused = paused;
    }

    /** Where the target is, in words, for the status region and the card's description. */
    function announceWhere(current: QuestState) {
        const path = current.tracked;
        if (!path || current.quests[path].done) {
            whereText = undefined;
            return;
        }
        const scene = gameManager.tryGetCurrentGameScene();
        let described: { name: string; position: Point } | undefined;
        let player: Point | undefined;
        if (scene) {
            try {
                const target = sceneQuestTarget(scene, path, current, world);
                const position = target ? targetPosition(scene, target) : undefined;
                if (target && position) described = { name: target.name, position };
                player = playerFeet(scene);
            } catch {
                described = undefined;
            }
        }
        // Explore's fixed area, when this map is ready without it: it is in another room.
        const missingArea =
            path === "explore" && current.exploreArea && world.ready && !world.exploreTarget
                ? current.exploreArea.name
                : undefined;
        whereText = whereDescription(t, described, player, path, missingArea);
        if (whereText) questAnnouncementStore.push(whereText);
    }

    // ---- The card's fold: on the X, the first movement after 3 s, or 10 s, whichever comes first ------------------
    // Both count only while the card can be seen (not covered, a map there). Focus inside it or the pointer over it
    // (the person is reading or using it) ends the countdown for good: then only the X, Escape or walking away
    // close it.
    let foldClock: ReturnType<typeof setInterval> | undefined;
    let foldShownMs = 0;
    let foldLast: Point | undefined;
    let foldWasWalking = false;

    function stopAutoFold() {
        if (foldClock) clearInterval(foldClock);
        foldClock = undefined;
        foldShownMs = 0;
        foldLast = undefined;
        foldWasWalking = false;
    }

    function fold() {
        stopAutoFold();
        if (cardEngaged()) return;
        if (get(questStateStore).surface === "card") dispatchQuest({ type: "close" });
    }

    /** Keyboard focus is inside the card (its dialog): a person is reading or using it. */
    function cardEngaged(): boolean {
        const active = document.activeElement;
        return !!active && active !== document.body && !!document.getElementById(CARD_ID)?.contains(active);
    }

    function startAutoFold() {
        stopAutoFold();
        foldClock = setInterval(tickAutoFold, CARD_FOLD_TICK_MS);
    }

    function tickAutoFold() {
        if (visible !== "card" || !gameManager.tryGetCurrentGameScene()) return;
        if (cardEngaged()) {
            stopAutoFold();
            return;
        }
        foldShownMs += CARD_FOLD_TICK_MS;
        if (foldShownMs >= CARD_FOLD_MS) {
            fold();
            return;
        }
        if (foldShownMs < CARD_FOLD_MOVE_AFTER_MS) return;
        const player = gameManager.tryGetCurrentGameScene()?.CurrentPlayer;
        if (!player) return;
        const position = { x: player.x, y: player.y };
        // The card's own "Walk there" is not the player leaving: its Stop walking stays in reach, and where that
        // walk left the player is the new starting point, not a movement.
        const walking = get(questWalkingStore);
        const moved =
            !!foldLast && !walking && !foldWasWalking && (foldLast.x !== position.x || foldLast.y !== position.y);
        foldLast = position;
        foldWasWalking = walking;
        if (moved) fold();
    }

    /** The quest whose pill has been reported shown (once per tracked quest). */
    let pillShownFor: QuestPath | null = null;
    $: void onVisibleChange(visible);
    async function onVisibleChange(next: QuestVisibleSurface) {
        const before = previousVisible;
        previousVisible = next;
        if (before === next) return;
        if (next === "pill" && tracked && pillShownFor !== tracked) {
            pillShownFor = tracked;
            analyticsClient.questTracker({ action: "shown", device: questDevice() });
        }
        const active = document.activeElement;
        const focusWasInside =
            !!active &&
            active !== document.body &&
            ((dock?.contains(active) ?? false) || (panel?.containsFocus() ?? false));
        await tick();
        if (takeQuestFocus(next)) {
            focusCloseOf(next);
            return;
        }
        // Only keyboard focus is ever inside: a click or a tap leaves none behind (questControls).
        if (!focusWasInside) return;
        if (before === "options" && next === "invitation") invitation?.focusShowOptions();
        else if (before === "options" && next === "card") card?.focusClose();
        else if (before === "card" && next === "pill") pill?.focus();
        else if (before === "log") {
            // The panel closed because a quest was taken (its card opens): focus goes there, and the panel's
            // opener is forgotten. Closed to the pill: back to the opener, or the pill itself.
            const opener = takeQuestLogOpener();
            if (next === "card") card?.focusClose();
            else if (next === "options") options?.focusClose();
            else if (opener?.isConnected) opener.focus();
            else if (next === "pill") pill?.focus();
            else profileMenuTrigger()?.focus();
        } else if (next === "none") {
            // Faded or covered: the surface is still fading out and holds focus until it goes. Move it now.
            profileMenuTrigger()?.focus();
        }
        // Whatever held focus is gone (replaced or hidden): never leave it on the page body.
        if (!document.activeElement || document.activeElement === document.body) profileMenuTrigger()?.focus();
    }

    function focusCloseOf(surface: QuestVisibleSurface) {
        if (surface === "options") options?.focusClose();
        else if (surface === "card") card?.focusClose();
        else if (surface === "log") panel?.focusClose();
    }

    // ---- Invitation and options ------------------------------------------------------------------------------------
    function onShowOptions(keyboard: boolean) {
        if (keyboard) requestQuestFocus("options");
        dispatchQuest({ type: "open-options" });
    }

    function onAccept(path: QuestPath) {
        const from = anyAccepted(state) ? "follow-up" : "invitation";
        acceptQuest(path, from);
    }

    $: optionsTitle = anyAccepted(state) ? t.quest.options.tryAnother() : t.quest.options.title();
    $: rows = optionRows(t, $questAvailablePathsStore, state, world);

    // ---- Pill, card and panel ------------------------------------------------------------------------------------
    /** The pill: the panel's handle. Opens it, or closes it when it is up. */
    function onTogglePanel(keyboard: boolean) {
        if (state.surface === "log") {
            dispatchQuest({ type: "close" });
            return;
        }
        openQuestLog(null, keyboard);
        analyticsClient.questTracker({ action: "expanded", device: questDevice() });
    }

    function onWalk() {
        if (!tracked) return;
        const scene = gameManager.tryGetCurrentGameScene();
        const target = scene ? sceneQuestTarget(scene, tracked, state, world) : undefined;
        if (target) void walkToQuestTarget(target);
    }

    /** Build's shortcut: the editor opens where the person stands, and the quest surface steps aside for it. */
    function onOpenEditor() {
        if (!world.canBuild) return;
        if (state.surface === "card" || state.surface === "log") dispatchQuest({ type: "close" });
        mapEditorModeStore.switchMode(true);
    }

    /** "Choose another" on the card: the panel. */
    function onOpenPanel(keyboard: boolean) {
        openQuestLog(null, keyboard);
    }

    // With nothing on the map, the pill says how much the panel has to offer: available here, or accepted.
    $: toDo = $questAvailablePathsStore.length + $questAcceptedCountStore;
    $: pillLabel = tracked ? objective : t.quest.quests();

    // ---- Celebration: sound and burst at once, the card for ~3 s of visible time, then the panel ------------------
    let celebrationShownMs = 0;
    let celebrationClock: ReturnType<typeof setInterval> | undefined;
    let celebrationKey: string | undefined;

    function stopCelebrationClock() {
        if (celebrationClock) clearInterval(celebrationClock);
        celebrationClock = undefined;
    }

    let celebrationKind: "quest" | "chapter" | undefined;
    $: celebrationKind = state.surface === "celebration" ? (state.celebrating ? "quest" : "chapter") : undefined;
    $: onCelebration(celebrationKind, state.celebrating, visible === "celebration" && !$questQuiet);
    function onCelebration(kind: "quest" | "chapter" | undefined, path: QuestPath | null, running: boolean) {
        const key = kind ? `${kind}:${path ?? ""}:${path ? state.quests[path].doneAt ?? "" : ""}` : undefined;
        if (key !== celebrationKey) {
            celebrationKey = key;
            celebrationShownMs = 0;
            if (kind === "quest" && path) {
                questAnnouncementStore.push(
                    t.quest.announce.done({ objective: questObjective(t, path, state, world) })
                );
                questAnnouncementStore.push(questPayoffLine(t, path, state, world));
                playQuestDone();
                burstQuestMarker();
            } else if (kind === "chapter") {
                questAnnouncementStore.push(t.quest.celebration.chapterTitle());
                playChapterDone();
                burstQuestMarker();
            }
        }
        if (!kind || !running) {
            stopCelebrationClock();
            return;
        }
        const total = kind === "chapter" ? CHAPTER_CELEBRATION_MS : CELEBRATION_MS;
        celebrationClock ??= setInterval(() => {
            if (!gameManager.tryGetCurrentGameScene()) return;
            celebrationShownMs += CELEBRATION_TICK_MS;
            if (celebrationShownMs >= total) {
                stopCelebrationClock();
                settleQuestCelebration();
            }
        }, CELEBRATION_TICK_MS);
    }

    // Tapping it skips ahead to the panel.
    function onCelebrationSkip() {
        stopCelebrationClock();
        settleQuestCelebration();
    }

    $: celebratedPath = state.celebrating;
    $: celebrationLine = celebratedPath
        ? questPayoffLine(t, celebratedPath, state, world)
        : t.quest.celebration.chapterLine();
    $: celebrationBadge = celebratedPath
        ? t.quest.celebration.badgeEarned({ stamp: stampName(t, celebratedPath) })
        : QUEST_PATHS.map((path) => stampName(t, path)).join(" · ");

    // ---- Sign in ---------------------------------------------------------------------------------------------------
    function onSignIn() {
        // Progress is already saved (every change is): nothing is lost by leaving for the sign-in page.
        goToLogin();
    }

    // ---- Panel: its own history entry, so Back closes it -----------------------------------------------------------
    let closeHistory: (() => void) | undefined;
    $: onPanelOpen(state.surface === "log");
    function onPanelOpen(open: boolean) {
        if (open && !closeHistory) {
            closeHistory = openQuestLogHistory(() => {
                closeHistory = undefined;
                dispatchQuest({ type: "close" });
            });
        } else if (!open && closeHistory) {
            const close = closeHistory;
            closeHistory = undefined;
            close();
        }
    }

    $: entries = logEntries(t, state, world, $questAvailablePathsStore);
    $: showSignInRow = ENABLE_OPENID && !$userIsConnected;

    // ---- Status region: one message at a time, never while someone is typing ------------------------------------
    let announcement = "";
    let announceTimer: ReturnType<typeof setTimeout> | undefined;
    const typing = () => get(inputFormFocusStore) || get(chatInputFocusStore) || get(menuInputFocusStore);

    function stopAnnouncing() {
        if (announceTimer) clearTimeout(announceTimer);
        announceTimer = undefined;
    }

    function announceNext() {
        if (announceTimer) return;
        if (typing()) {
            announceTimer = setTimeout(() => {
                announceTimer = undefined;
                announceNext();
            }, ANNOUNCE_MS);
            return;
        }
        const next = questAnnouncementStore.take();
        if (!next) {
            announcement = "";
            return;
        }
        announcement = next;
        announceTimer = setTimeout(() => {
            announceTimer = undefined;
            announceNext();
        }, ANNOUNCE_MS);
    }
    $: if ($questAnnouncementStore.length > 0) announceNext();

    // The pill stays under the panel as its handle; every other surface takes its place.
    $: showPill = visible === "pill" || visible === "log";
    $: showSurface = visible !== "none" && visible !== "pill" && visible !== "log";

    // Read when a surface leaves: it fades only when nothing replaces it (faded or covered), else it is swapped at
    // once for the next one.
    function fadeOutMs(): number {
        return visible === "none" ? motionMs(300) : 0;
    }
</script>

<!-- The status region is always here (even while quests are covered), so nothing announced is lost. -->
<div role="status" aria-live="polite" aria-atomic="true" class="sr-only" data-testid="quest-status">{announcement}</div>

<!-- The layer the map marks sit in: over the map, never catching a tap. -->
<div class="absolute inset-0 overflow-hidden pointer-events-none" bind:this={layer}>
    <QuestMapMarks
        path={markedPath}
        giverUserId={giverMarkUserId}
        {layer}
        avoid={dock}
        suppressed={$questSurfaceSuppressed}
    />
</div>

<!-- The frame gives the surfaces the section's height to size against (cqh). -->
<div class="quest-dock-frame" data-testid="quest-dock-frame">
    <!-- Anchored to the physical left, like the Express column is to the physical right: the two never share a
         corner, in Arabic too. Everything inside uses logical start/end. Only the surfaces take taps: the rest of the
         dock lets them through to the map, so the joystick and tap-to-walk work around it. -->
    <div
        class="absolute bottom-2 left-1 md:left-2 xl:left-4 flex flex-col items-start gap-2 pointer-events-none w-[calc(100%-5.5rem)] md:max-w-[22rem]"
        data-testid="quest-dock"
        bind:this={dock}
    >
        {#if visible === "log"}
            <div class="w-full flex" in:fly={{ y: 16, duration: motionMs(220) }} out:fade={{ duration: motionMs(120) }}>
                <QuestPanel
                    bind:this={panel}
                    id={PANEL_ID}
                    {entries}
                    {world}
                    doneCount={doneCount(state)}
                    total={QUEST_PATHS.length}
                    {tracked}
                    {trackedBody}
                    {walkLabel}
                    walking={$questWalkingStore}
                    {editorLabel}
                    {showSignInRow}
                    on:close={() => dispatchQuest({ type: "close" })}
                    on:accept={(event) => acceptQuest(event.detail, "log")}
                    on:track={(event) => trackQuest(event.detail, "log")}
                    on:walk={onWalk}
                    on:stopWalking={() => stopQuestWalk()}
                    on:openEditor={onOpenEditor}
                    on:signIn={onSignIn}
                />
            </div>
        {/if}
        {#key showSurface ? visible : "pill"}
            {#if showSurface}
                <div
                    class="w-full flex"
                    in:fly={{ y: 12, duration: motionMs(200) }}
                    out:fade={{ duration: fadeOutMs() }}
                >
                    {#if visible === "invitation"}
                        <QuestInvitation
                            bind:this={invitation}
                            host={offerPortrait}
                            {eyebrow}
                            on:showOptions={(event) => onShowOptions(event.detail.keyboard)}
                            on:notNow={() => declineQuestInvitation()}
                        />
                    {:else if visible === "options"}
                        <QuestOptions
                            bind:this={options}
                            host={offerPortrait}
                            title={optionsTitle}
                            {rows}
                            on:close={() => dispatchQuest({ type: "close" })}
                            on:accept={(event) => onAccept(event.detail)}
                        />
                    {:else if visible === "card" && tracked}
                        <QuestCard
                            bind:this={card}
                            id={CARD_ID}
                            host={cardHost}
                            eyebrow={cardEyebrow}
                            title={objective}
                            body={trackedBody}
                            whereDescription={whereText}
                            {walkLabel}
                            walking={$questWalkingStore}
                            {editorLabel}
                            done={trackedDone}
                            on:close={() => dispatchQuest({ type: "close" })}
                            on:engage={stopAutoFold}
                            on:walk={onWalk}
                            on:stopWalking={() => stopQuestWalk()}
                            on:openEditor={onOpenEditor}
                            on:chooseAnother={(event) => onOpenPanel(event.detail.keyboard)}
                        />
                    {:else if visible === "celebration" && celebrationKind}
                        <QuestCelebration
                            kind={celebrationKind}
                            path={celebratedPath}
                            eyebrow={celebratedPath ? questEyebrowFor(t, celebratedPath, state, world) : ""}
                            line={celebrationLine}
                            badgeLine={celebrationBadge}
                            stampLabel={celebratedPath
                                ? t.quest.stamps.badge({ stamp: stampName(t, celebratedPath) })
                                : ""}
                            on:skip={onCelebrationSkip}
                        />
                    {/if}
                </div>
            {:else if showPill}
                <div
                    class="w-full flex"
                    in:fly={{ y: 12, duration: motionMs(200) }}
                    out:fade={{ duration: fadeOutMs() }}
                >
                    <QuestPill
                        bind:this={pill}
                        path={tracked}
                        label={pillLabel}
                        count={tracked ? 0 : toDo}
                        done={trackedDone}
                        walking={$questWalkingStore}
                        open={visible === "log"}
                        panelId={PANEL_ID}
                        on:toggle={(event) => onTogglePanel(event.detail.keyboard)}
                    />
                </div>
            {/if}
        {/key}
    </div>
</div>

<style lang="scss">
    /* Shared by every quest surface. Dark glass at 90% so small text keeps its contrast over a white floor. Sizes in
       rem, so they follow the text-size setting. */
    :global(.quest-surface) {
        box-sizing: border-box;
        color: #fff;
        background: rgb(27 42 65 / 0.9);
        border: 1px solid rgba(167, 139, 250, 0.22);
        border-radius: 0.5rem;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
    }
    :global(.quest-dock-frame) {
        position: absolute;
        inset: 0;
        pointer-events: none;
        container-type: size;
    }
    :global(.quest-max-h) {
        max-height: 40vh;
        max-height: 40cqh;
    }
    /* Close and portrait on one row; below 12rem of card (a phone at large text) the title takes its own row. */
    :global(.quest-header) {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: 0.75rem;
    }
    :global(.quest-header-close) {
        order: 1;
        flex-shrink: 0;
        margin-inline-start: auto;
    }
    :global(.quest-header-text) {
        order: 2;
        flex: 1 0 100%;
        min-width: 0;
        overflow-wrap: anywhere;
    }
    @container quest (min-width: 12rem) {
        :global(.quest-header-text) {
            order: 0;
            flex: 1 1 0%;
        }
    }
    /* Not .u-eyebrow: no letter-spacing (Arabic stays joined), no capitals (names keep their case). */
    :global(.quest-eyebrow) {
        font-size: 0.8125rem;
        font-weight: 600;
        line-height: 1.3;
        letter-spacing: 0;
        text-transform: none;
        color: #c4b5fd;
    }
    :global(.quest-secondary) {
        font-size: 0.8125rem;
        line-height: 1.4;
        color: rgba(255, 255, 255, 0.8);
    }
    :global(.quest-meta) {
        margin-top: 0.125rem;
        font-size: 0.75rem;
        line-height: 1.3;
        color: rgba(255, 255, 255, 0.55);
    }
    /* Every action is a real 44px pill button: the gradient one is the primary, the glass one secondary. Minimum
       sizes only: text wraps and cards grow, nothing is clipped at 200% text. */
    :global(.quest-btn) {
        display: inline-flex;
        align-items: center;
        margin: 0;
        min-height: 2.75rem;
        padding: 0.5rem 1.125rem;
        justify-content: center;
        border-radius: 999px;
        white-space: normal;
        text-align: center;
        font-size: 0.875rem;
        font-weight: 700;
        line-height: 1.25;
        cursor: pointer;
    }
    :global(.quest-ghost) {
        color: #fff;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.2);
    }
    :global(.quest-ghost:hover) {
        background: rgba(255, 255, 255, 0.12);
    }
    :global(.quest-btn-small) {
        min-height: 2.25rem;
        padding: 0.25rem 0.875rem;
        font-size: 0.8125rem;
    }
    :global(.quest-row) {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        width: 100%;
        min-height: 3.5rem;
        margin: 0;
        padding: 0.5rem;
        border-radius: 0.5rem;
        color: #fff;
        background: transparent;
        text-align: start;
        font-size: 0.875rem;
        line-height: 1.3;
        cursor: pointer;
    }
    :global(button.quest-row:hover) {
        background: rgba(255, 255, 255, 0.08);
    }
    :global(.quest-row-done) {
        cursor: default;
        opacity: 0.75;
    }
    /* The panel: the pill's own width, above it, its list scrolling inside. */
    :global(.quest-panel) {
        max-height: 60vh;
        max-height: 60cqh;
    }
    :global(.quest-entry-open) {
        border-radius: 0.5rem;
        background: rgba(255, 255, 255, 0.06);
    }
    :global(.quest-entry-open .quest-row) {
        cursor: default;
    }
    :global(.quest-entry-details) {
        padding: 0 0.5rem 0.625rem 3.5rem;
        padding-inline: 3.5rem 0.5rem;
        font-size: 0.875rem;
    }
    :global(.quest-log-section) {
        margin: 0.75rem 0 0.25rem;
        font-size: 0.75rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.6);
    }
    /* The chapter's progress: one segment per quest, amber once done. */
    :global(.quest-progress) {
        display: flex;
        gap: 0.25rem;
        height: 0.25rem;
    }
    :global(.quest-progress-seg) {
        flex: 1;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.15);
        transition: background 300ms ease;
    }
    :global(.quest-progress-seg.lit) {
        background: linear-gradient(90deg, #c4b5fd, #f5a623);
    }
    /* Row tags: "On the map" in amber, "Tap to start" quiet. */
    :global(.quest-tag) {
        flex: none;
        padding: 0.125rem 0.5rem;
        border-radius: 999px;
        font-size: 0.6875rem;
        font-weight: 700;
        white-space: nowrap;
        color: #1b2a41;
        background: #f5a623;
    }
    :global(.quest-tag-quiet) {
        color: rgba(255, 255, 255, 0.7);
        background: rgba(255, 255, 255, 0.1);
    }
    :global(.quest-stamp-mini) {
        flex: none;
        display: flex;
        opacity: 0.8;
    }
    :global(.quest-check) {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 999px;
        color: #1b2a41;
        background: #e9c74c;
    }
    /* The pill: a 44px glass capsule with a 1px hairline in the landing page's lavender-to-amber, drawn by a masked
       pseudo-element behind a transparent border (a gradient cannot round a border by itself). */
    :global(.quest-pill) {
        position: relative;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        height: 2.75rem;
        max-width: 100%;
        margin: 0;
        padding: 0 0.75rem 0 0.625rem;
        padding-inline: 0.625rem 0.75rem;
        border-radius: 999px;
        color: #fff;
        background: rgb(27 42 65 / 0.9);
        border: 1px solid transparent;
        background-clip: padding-box;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        font-size: 0.875rem;
        font-weight: 600;
        white-space: nowrap;
        pointer-events: auto;
        cursor: pointer;
        transition: transform 150ms ease;
    }
    :global(.quest-pill::before) {
        content: "";
        position: absolute;
        inset: -1px;
        padding: 1px;
        border-radius: inherit;
        background: linear-gradient(135deg, #c4b5fd, #f5a623);
        -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
        mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
        opacity: 0.6;
        pointer-events: none;
        transition: opacity 150ms ease;
    }
    :global(button.quest-pill:hover),
    :global(button.quest-pill:focus-visible) {
        transform: translateY(-1px);
    }
    :global(button.quest-pill:hover::before),
    :global(button.quest-pill:focus-visible::before),
    :global(.quest-pill-open::before) {
        opacity: 1;
    }
    :global(button.quest-pill:active) {
        transform: translateY(0);
    }
    /* The badge's glyph: the pill's icon. It pops once on completion. */
    :global(.quest-pill-glyph) {
        flex: none;
        display: flex;
        width: 1.375rem;
        height: 1.375rem;
    }
    :global(.quest-pill-pop) {
        animation: quest-pill-pop 350ms ease-out both;
    }
    @keyframes quest-pill-pop {
        0% {
            transform: scale(1);
        }
        50% {
            transform: scale(1.25);
        }
        100% {
            transform: scale(1);
        }
    }
    /* The label always has room: it shrinks with an ellipsis, never to nothing. */
    :global(.quest-pill-label) {
        flex: 0 1 auto;
        min-width: 3rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    /* The chevron says "panel": up when it is closed, down (turned) while it is open. Always visible. */
    :global(.quest-pill-chevron) {
        flex: none;
        color: rgba(255, 255, 255, 0.7);
        transition: transform 200ms ease, color 150ms ease;
    }
    :global(.quest-pill:hover .quest-pill-chevron),
    :global(.quest-pill:focus-visible .quest-pill-chevron) {
        color: #fff;
    }
    :global(.quest-pill-open .quest-pill-chevron) {
        transform: rotate(180deg);
    }
    /* While "Walk there" walks the player: a 2px amber line runs along the bottom edge, inside the capsule. */
    :global(.quest-pill-progress) {
        position: absolute;
        left: 0.875rem;
        right: 0.875rem;
        bottom: 3px;
        height: 2px;
        border-radius: 1px;
        overflow: hidden;
        background: rgba(245, 166, 35, 0.25);
        pointer-events: none;
    }
    :global(.quest-pill-progress::after) {
        content: "";
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        width: 40%;
        border-radius: inherit;
        background: #f5a623;
        animation: quest-pill-shimmer 1.2s ease-in-out infinite;
    }
    @keyframes quest-pill-shimmer {
        from {
            transform: translateX(-100%);
        }
        to {
            transform: translateX(250%);
        }
    }
    /* The celebration: the stamp thumps in and settles, a shine sweeps across once. */
    :global(.quest-celebration) {
        position: relative;
        display: flex;
        align-items: center;
        gap: 0.875rem;
        width: 100%;
        min-height: 4.5rem;
        margin: 0;
        padding: 0.75rem 0.875rem;
        overflow: hidden;
        text-align: start;
        cursor: pointer;
        border-color: rgba(245, 166, 35, 0.55);
        box-shadow: 0 0 0 1px rgba(245, 166, 35, 0.2), 0 12px 32px -12px rgba(245, 166, 35, 0.6);
        animation: quest-celebration-in 320ms cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    :global(.quest-celebration-chapter) {
        justify-content: center;
        padding: 1rem 0.875rem;
    }
    :global(.quest-celebration-title) {
        font-size: 0.75rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #f5a623;
    }
    :global(.quest-badge-line) {
        margin-top: 0.25rem;
        font-size: 0.8125rem;
        font-weight: 600;
        color: #e9c74c;
    }
    :global(.quest-celebration-stamp) {
        flex: none;
        display: flex;
        animation: quest-stamp-in 600ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
        filter: drop-shadow(0 0 10px rgba(233, 199, 76, 0.55));
    }
    :global(.quest-celebration-shine) {
        position: absolute;
        inset: -50% auto -50% -30%;
        width: 30%;
        background: linear-gradient(105deg, transparent, rgba(255, 255, 255, 0.22), transparent);
        transform: skewX(-18deg) translateX(-100%);
        animation: quest-shine 1.1s ease-out 350ms both;
        pointer-events: none;
    }
    @keyframes quest-celebration-in {
        from {
            transform: translateY(10px) scale(0.96);
            opacity: 0;
        }
        to {
            transform: none;
            opacity: 1;
        }
    }
    @keyframes quest-stamp-in {
        0% {
            transform: scale(2.2) rotate(-18deg);
            opacity: 0;
        }
        55% {
            opacity: 1;
        }
        100% {
            transform: scale(1) rotate(6deg);
            opacity: 1;
        }
    }
    @keyframes quest-shine {
        to {
            transform: skewX(-18deg) translateX(500%);
        }
    }
    /* The game's button reset removes outlines: keyboard focus must stay visible on every quest control. */
    :global(.quest-btn:focus-visible),
    :global(.quest-row:focus-visible),
    :global(.quest-pill:focus-visible),
    :global(.quest-celebration:focus-visible),
    :global(.quest-surface .close-btn:focus-visible) {
        outline: 2px solid #c4b5fd !important;
        outline-offset: 2px;
    }
    @media (prefers-reduced-motion: reduce) {
        :global(.quest-surface .u-cta),
        :global(.quest-surface .u-cta::before),
        :global(.quest-pill),
        :global(.quest-pill::before),
        :global(.quest-pill-chevron),
        :global(.quest-progress-seg) {
            transition: none;
        }
        :global(.quest-surface .u-cta:hover),
        :global(.quest-surface .u-cta:active),
        :global(button.quest-pill:hover),
        :global(button.quest-pill:focus-visible) {
            transform: none;
        }
        :global(.quest-pill-pop),
        :global(.quest-celebration),
        :global(.quest-celebration-stamp),
        :global(.quest-celebration-shine) {
            animation: none;
        }
        /* A still, full line: still says "walking". */
        :global(.quest-pill-progress) {
            background: #f5a623;
        }
        :global(.quest-pill-progress::after) {
            animation: none;
            display: none;
        }
    }
</style>
