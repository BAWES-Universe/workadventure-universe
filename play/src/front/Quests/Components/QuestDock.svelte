<script lang="ts">
    import { onDestroy, tick } from "svelte";
    import { fade, fly } from "svelte/transition";
    import { get } from "svelte/store";
    import { LL } from "../../../i18n/i18n-svelte";
    import { ENABLE_OPENID } from "../../Enum/EnvironmentVariable";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { userIsConnected } from "../../Stores/MenuStore";
    import { gameSceneStore } from "../../Stores/GameSceneStore";
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
    import { questDockWidthStore } from "../QuestDevSettings";
    import {
        openQuestLog,
        profileMenuTrigger,
        requestQuestFocus,
        takeQuestFocus,
        takeQuestLogOpener,
    } from "../QuestDockFocus";
    import type { Point } from "../QuestGeometry";
    import { worldToSectionPoint } from "../QuestGeometry";
    import { openQuestLogHistory } from "../QuestLogHistory";
    import { startQuestMarkers } from "../QuestMarkers";
    import type { QuestFollowUp, QuestPath, QuestState, QuestSurface, QuestVisibleSurface } from "../QuestModel";
    import { anyAccepted, markedQuestPath } from "../QuestModel";
    import { motionMs } from "../QuestMotion";
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
        setQuestsHidden,
        settleQuestPayoff,
        skipQuestSignInOffer,
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
    import QuestFollowUpCard from "./QuestFollowUp.svelte";
    import QuestInvitation from "./QuestInvitation.svelte";
    import QuestLog from "./QuestLog.svelte";
    import QuestMapMarks from "./QuestMapMarks.svelte";
    import QuestOptions from "./QuestOptions.svelte";
    import QuestPayoff from "./QuestPayoff.svelte";
    import QuestPill from "./QuestPill.svelte";
    import QuestsPill from "./QuestsPill.svelte";

    /** The payoff line stays this long, counted only while it can be seen. */
    const PAYOFF_VISIBLE_MS = 6_000;
    const PAYOFF_TICK_MS = 250;
    /** A completion that waited longer than this shows its stamp already settled, without the flight. */
    const SETTLED_AFTER_MS = 60_000;
    /** Each announcement stays in the status region this long, so it is read before the next one. */
    const ANNOUNCE_MS = 1_500;
    /** A card opened by Start or Follow folds to the pill after this long of being seen... */
    export const CARD_FOLD_MS = 10_000;
    /** ...or on the player's first movement after this long, whichever comes first. */
    export const CARD_FOLD_MOVE_AFTER_MS = 3_000;
    const CARD_FOLD_TICK_MS = 250;
    const CARD_ID = "quest-card";

    let dock: HTMLElement | undefined;
    let layer: HTMLElement | undefined;
    let invitation: QuestInvitation | undefined;
    let options: QuestOptions | undefined;
    let card: QuestCard | undefined;
    let log: QuestLog | undefined;
    let pill: QuestPill | undefined;
    let questsPill: QuestsPill | undefined;

    $: state = $questStateStore;
    $: world = $questWorldStore;
    $: visible = $questVisibleSurfaceStore;
    $: t = $LL;
    // The invitation and the options speak for the giver frozen when the offer was shown (its name stays as the
    // player walks out of the bot's range); a quest's card and payoff for the giver frozen at acceptance.
    $: eyebrow = offerEyebrow(t, state, world);
    $: offerPortrait = offerHost(state, world);
    $: tracked = state.tracked;
    $: objective = tracked ? questObjective(t, tracked, state, world) : "";
    $: cardEyebrow = tracked ? questEyebrowFor(t, tracked, state, world) : eyebrow;
    $: cardHost = tracked ? giverAsHost(entryOrigin(state, tracked, world).giver, world) : offerPortrait;

    // Walk: an area, or a person on this map; hidden once no path leads there.
    $: walkTarget = tracked ? questTarget(tracked, state, world) : undefined;
    $: walkLabel =
        tracked && walkTarget && !$questUnreachableStore.has(targetKey(walkTarget))
            ? tracked === "explore"
                ? t.quest.paths.explore.walk({ area: walkTarget.name })
                : t.quest.card.walkThere()
            : undefined;

    // The map marks: the followed quest's target, always; the giver bot while its offer is on screen.
    $: markedPath = markedQuestPath(state);
    $: giverMarkUserId = questGiverUserId(state, world);

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
        stopPayoffClock();
        stopAutoFold();
        // A reconnect or a room change closes the log, as it closes the person card: Back must not land on a
        // log that is no longer there.
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
            // Opened by Start or Follow (not from its pill): it folds by itself once it has been seen.
            if (previousSurface !== "pill") startAutoFold();
            announceWhere(current);
        } else if (current.surface !== "card") {
            stopAutoFold();
            if (previousSurface === "card") whereText = undefined;
        }
        const paused = current.quests.meet.paused;
        if (paused && !previousPaused && current.tracked === "meet")
            questAnnouncementStore.push(t.quest.card.nobodyHere());
        if (current.surface === "follow-up" && current.followUp === "sign-in" && previousSurface !== "follow-up") {
            questAnnouncementStore.push(t.quest.followUp.signInTitle());
        }
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
    // Both count only while the card can be seen (not covered, a map there), like the payoff. Focus inside it or the
    // pointer over it (the person is reading or using it) ends the countdown for good: then only the X, Escape or
    // walking away close it.
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
            ((dock?.contains(active) ?? false) || (log?.containsFocus() ?? false));
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
            // The log closed because Start or Follow opened a card: focus goes there, and the log's opener (the
            // profile menu's trigger, the pill) is forgotten. Closed to a resting surface: back to the opener.
            const opener = takeQuestLogOpener();
            if (next === "card") card?.focusClose();
            else if (next === "options") options?.focusClose();
            else if (opener?.isConnected) opener.focus();
            else if (next === "pill") pill?.focus();
            else if (next === "quests") questsPill?.focus();
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
        else if (surface === "log") log?.focusClose();
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

    // ---- Pills and card ----------------------------------------------------------------------------------------
    function onOpenCard(keyboard: boolean) {
        if (keyboard) requestQuestFocus("card");
        dispatchQuest({ type: "open-card" });
        analyticsClient.questTracker({ action: "expanded", device: questDevice() });
    }

    function onWalk() {
        if (!tracked) return;
        const scene = gameManager.tryGetCurrentGameScene();
        const target = scene ? sceneQuestTarget(scene, tracked, state, world) : undefined;
        if (target) void walkToQuestTarget(target);
    }

    /** "Choose another" on the card, and the resting Quests pill: the log. */
    function onOpenLog(keyboard: boolean) {
        openQuestLog(null, keyboard);
    }

    // What the log has to offer, on the resting pill: available here, or accepted and not followed.
    $: toDo = $questAvailablePathsStore.length + $questAcceptedCountStore;

    // ---- Payoff: shown for 6 s of visible time, then at most one follow-up card --------------------------------------
    let payoffShownMs = 0;
    let payoffClock: ReturnType<typeof setInterval> | undefined;
    let payoffFrom: Point | undefined;
    let payoffKey: string | undefined;

    function stopPayoffClock() {
        if (payoffClock) clearInterval(payoffClock);
        payoffClock = undefined;
    }

    function followUpAfterPayoff(): QuestFollowUp | null {
        if (!get(userIsConnected) && ENABLE_OPENID && !state.signInOfferSkipped) return "sign-in";
        return get(questAvailablePathsStore).length > 0 ? "continuation" : null;
    }

    $: payoffPath = state.payoff;
    $: onPayoff(payoffPath, visible === "payoff" && !$questQuiet);
    function onPayoff(path: QuestPath | null, running: boolean) {
        const key = path ? `${path}:${state.quests[path].doneAt ?? ""}` : undefined;
        if (key !== payoffKey) {
            payoffKey = key;
            payoffShownMs = 0;
            payoffFrom = undefined;
            if (path) {
                questAnnouncementStore.push(
                    t.quest.announce.done({ objective: questObjective(t, path, state, world) })
                );
                const waited = Date.now() - (state.quests[path].doneAt ?? Date.now());
                if (waited < SETTLED_AFTER_MS) payoffFrom = wokaScreenPoint();
            }
        }
        if (!path || !running) {
            stopPayoffClock();
            return;
        }
        payoffClock ??= setInterval(() => {
            if (!gameManager.tryGetCurrentGameScene()) return;
            payoffShownMs += PAYOFF_TICK_MS;
            if (payoffShownMs >= PAYOFF_VISIBLE_MS) {
                stopPayoffClock();
                settleQuestPayoff(followUpAfterPayoff());
            }
        }, PAYOFF_TICK_MS);
    }

    /** Where the player's Woka is drawn, relative to the dock's layer: where the stamp rises from. */
    function wokaScreenPoint(): Point | undefined {
        const scene = gameManager.tryGetCurrentGameScene();
        const feet = scene ? playerFeet(scene) : undefined;
        if (!scene || !feet || !layer) return undefined;
        try {
            const camera = scene.cameras.main;
            return worldToSectionPoint(
                { x: feet.x, y: feet.y - 32 },
                { worldViewX: camera.worldView.x, worldViewY: camera.worldView.y, zoom: camera.zoom },
                scene.game.canvas.getBoundingClientRect(),
                { width: scene.scale.width, height: scene.scale.height },
                layer.getBoundingClientRect()
            );
        } catch {
            return undefined;
        }
    }

    function onPayoffTicked() {
        if (state.payoff) questAnnouncementStore.push(questPayoffLine(t, state.payoff, state, world));
    }

    // Tapping the line away ends it and skips this completion's follow-up.
    function onPayoffDismiss() {
        stopPayoffClock();
        settleQuestPayoff(null);
    }

    // ---- Follow-up ----------------------------------------------------------------------------------------------
    function onSignIn() {
        // Progress is already saved (every change is): nothing is lost by leaving for the sign-in page.
        goToLogin();
    }

    function onFollowUpClose() {
        if (state.followUp === "sign-in") skipQuestSignInOffer();
        else dispatchQuest({ type: "follow-up-closed" });
    }

    function onTryAnother(keyboard: boolean) {
        if (keyboard) requestQuestFocus("options");
        dispatchQuest({ type: "open-options" });
    }

    // ---- Log: its own history entry, so Back closes it ---------------------------------------------------------------
    let closeHistory: (() => void) | undefined;
    $: onLogOpen(state.surface === "log");
    function onLogOpen(open: boolean) {
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

    function onLogAccept(path: QuestPath) {
        acceptQuest(path, "log");
    }

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

    /** The card width switch is a development tool: production builds never render it. */
    const devBuild = import.meta.env.DEV;
    // Narrow: cards leave the Express column visible and stop at 22rem on desktop. Full: they span the section
    // (minus a gutter), on phones and on desktop alike, still anchored to the left.
    $: fullWidth = $questDockWidthStore === "full";
    $: widthClass = fullWidth ? "w-[calc(100%-1rem)]" : "w-[calc(100%-5.5rem)] md:max-w-[22rem]";
    $: coversExpress =
        fullWidth && visible !== "none" && visible !== "pill" && visible !== "quests" && visible !== "log";
    $: trackedDone = !!tracked && state.quests[tracked].done;

    // Read when a surface leaves: it fades only when nothing replaces it (faded, hidden or covered), else it is
    // swapped at once for the next one.
    function fadeOutMs(): number {
        return visible === "none" ? motionMs(300) : 0;
    }
</script>

<!-- The status region is always here (even while quests are hidden or covered), so nothing announced is lost. -->
<div role="status" aria-live="polite" aria-atomic="true" class="sr-only" data-testid="quest-status">{announcement}</div>

<!-- The layer the stamp flies in and the map marks sit in: over the map, never catching a tap. -->
<div class="absolute inset-0 overflow-hidden pointer-events-none" bind:this={layer}>
    <QuestMapMarks
        path={markedPath}
        giverUserId={giverMarkUserId}
        {layer}
        avoid={dock}
        suppressed={$questSurfaceSuppressed}
    />
</div>

{#if visible === "log"}
    <QuestLog
        bind:this={log}
        {entries}
        hidden={state.hidden}
        {showSignInRow}
        dockWidth={$questDockWidthStore}
        showWidthSwitch={devBuild}
        on:close={() => dispatchQuest({ type: "close" })}
        on:accept={(event) => onLogAccept(event.detail)}
        on:track={(event) => trackQuest(event.detail, "log")}
        on:setHidden={(event) => setQuestsHidden(event.detail)}
        on:signIn={onSignIn}
        on:setWidth={(event) => questDockWidthStore.set(event.detail)}
    />
{/if}

<!-- The frame gives the surfaces the section's height to size against (40cqh). In "full" width a card covers the
     Express column while it is open (z-index); the pills never do. -->
<div class="quest-dock-frame {coversExpress ? 'z-[1]' : ''}" data-testid="quest-dock-frame">
    <!-- Anchored to the physical left, like the Express column is to the physical right: the two never share a
         corner, in Arabic too. Everything inside uses logical start/end. Only the surfaces take taps: the rest of the
         dock lets them through to the map, so the joystick and tap-to-walk work around it. -->
    <div
        class="absolute bottom-2 left-1 md:left-2 xl:left-4 flex flex-col items-start gap-2 pointer-events-none {widthClass}"
        data-testid="quest-dock"
        bind:this={dock}
    >
        {#key visible}
            {#if visible !== "none" && visible !== "log"}
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
                    {:else if visible === "quests"}
                        <QuestsPill
                            bind:this={questsPill}
                            count={toDo}
                            on:open={(event) => onOpenLog(event.detail.keyboard)}
                        />
                    {:else if visible === "pill" && tracked}
                        <QuestPill
                            bind:this={pill}
                            path={tracked}
                            label={objective}
                            done={trackedDone}
                            walking={$questWalkingStore}
                            cardId={CARD_ID}
                            on:open={(event) => onOpenCard(event.detail.keyboard)}
                        />
                    {:else if visible === "card" && tracked}
                        <QuestCard
                            bind:this={card}
                            id={CARD_ID}
                            host={cardHost}
                            eyebrow={cardEyebrow}
                            title={objective}
                            body={questBody(t, tracked, state, world, $questMeetProgressStore)}
                            whereDescription={whereText}
                            {walkLabel}
                            walking={$questWalkingStore}
                            done={trackedDone}
                            on:close={() => dispatchQuest({ type: "close" })}
                            on:engage={stopAutoFold}
                            on:walk={onWalk}
                            on:stopWalking={() => stopQuestWalk()}
                            on:chooseAnother={(event) => onOpenLog(event.detail.keyboard)}
                        />
                    {:else if visible === "payoff" && state.payoff}
                        <QuestPayoff
                            path={state.payoff}
                            objective={questObjective(t, state.payoff, state, world)}
                            eyebrow={questEyebrowFor(t, state.payoff, state, world)}
                            line={questPayoffLine(t, state.payoff, state, world)}
                            stampLabel={t.quest.stamps.badge({ stamp: stampName(t, state.payoff) })}
                            flyFrom={payoffFrom}
                            {layer}
                            on:ticked={onPayoffTicked}
                            on:dismiss={onPayoffDismiss}
                        />
                    {:else if visible === "follow-up" && state.followUp}
                        <QuestFollowUpCard
                            kind={state.followUp}
                            on:close={onFollowUpClose}
                            on:signIn={onSignIn}
                            on:tryAnother={(event) => onTryAnother(event.detail.keyboard)}
                            on:backToExploring={() => dispatchQuest({ type: "follow-up-closed" })}
                        />
                    {/if}
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
    :global(.quest-ghost[aria-pressed="true"]) {
        color: #1b2a41;
        background: #e9c74c;
        border-color: #e9c74c;
    }
    /* A state, not a control ("Following"): the same shape, quieter, and never a pointer. */
    :global(.quest-static) {
        color: rgba(255, 255, 255, 0.7);
        cursor: default;
    }
    :global(.quest-btn-small) {
        min-height: 2.25rem;
        padding: 0.25rem 0.75rem;
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
    :global(.quest-row:hover) {
        background: rgba(255, 255, 255, 0.08);
    }
    /* The pills: a 44px glass capsule with a 1px hairline in the landing page's lavender-to-amber, drawn by a masked
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
    :global(button.quest-pill:focus-visible::before) {
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
    /* The chevron keeps its place and shows on hover or keyboard focus. */
    :global(.quest-pill-chevron) {
        flex: none;
        opacity: 0;
        color: rgba(255, 255, 255, 0.85);
        transition: opacity 150ms ease;
    }
    :global(.quest-pill:hover .quest-pill-chevron),
    :global(.quest-pill:focus-visible .quest-pill-chevron) {
        opacity: 1;
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
    :global(.quest-payoff) {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        width: 100%;
        min-height: 3.5rem;
        margin: 0;
        padding: 0.5rem 0.75rem;
        text-align: start;
        cursor: pointer;
    }
    /* On phones the log spans the section: above the Express column, which would otherwise take taps on its
       footer. On wider screens it is a side panel that leaves that column alone (a "full" card width widens it). */
    :global(.quest-log) {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1;
        max-height: 100%;
        border-radius: 0.5rem 0.5rem 0 0;
    }
    :global(.quest-log-backdrop) {
        position: absolute;
        left: 0;
        right: 0;
        z-index: 1;
        pointer-events: auto;
    }
    @media (min-width: 768px) {
        :global(.quest-log) {
            z-index: auto;
            left: 0.5rem;
            right: auto;
            bottom: 0.5rem;
            width: 24rem;
            max-height: 70vh;
            border-radius: 0.5rem;
        }
        :global(.quest-log.quest-log-full) {
            width: calc(100% - 1rem);
        }
    }
    @media (min-width: 1280px) {
        :global(.quest-log) {
            left: 1rem;
        }
        :global(.quest-log.quest-log-full) {
            width: calc(100% - 2rem);
        }
    }
    :global(.quest-log-section) {
        margin: 0.75rem 0 0.25rem;
        font-size: 0.75rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.6);
    }
    :global(.quest-log-details) {
        padding-inline: 3.5rem 0.5rem;
        padding-bottom: 0.5rem;
        font-size: 0.875rem;
    }
    :global(.quest-log-footer) {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    :global(.quest-stamp-flight) {
        position: absolute;
        top: 0;
        left: 0;
        pointer-events: none;
        will-change: transform;
    }
    /* The game's button reset removes outlines: keyboard focus must stay visible on every quest control. */
    :global(.quest-btn:focus-visible),
    :global(.quest-row:focus-visible),
    :global(.quest-pill:focus-visible),
    :global(.quest-payoff:focus-visible),
    :global(.quest-surface .close-btn:focus-visible) {
        outline: 2px solid #c4b5fd !important;
        outline-offset: 2px;
    }
    @media (prefers-reduced-motion: reduce) {
        :global(.quest-surface .u-cta),
        :global(.quest-surface .u-cta::before),
        :global(.quest-pill),
        :global(.quest-pill::before),
        :global(.quest-pill-chevron) {
            transition: none;
        }
        :global(.quest-surface .u-cta:hover),
        :global(.quest-surface .u-cta:active),
        :global(button.quest-pill:hover),
        :global(button.quest-pill:focus-visible) {
            transform: none;
        }
        :global(.quest-pill-pop) {
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
