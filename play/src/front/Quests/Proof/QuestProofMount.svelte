<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { AvailabilityStatus } from "@workadventure/messages";
    import { gameSceneStore, gameSceneIsLoadedStore } from "../../Stores/GameSceneStore";
    import type { UserInputManager } from "../../Phaser/UserInput/UserInputManager";
    import { chatInputFocusStore, chatVisibilityStore } from "../../Stores/ChatStore";
    import { modalVisibilityStore } from "../../Stores/ModalStore";
    import { menuVisiblilityStore, openedMenuStore } from "../../Stores/MenuStore";
    import { mapEditorVisibilityStore, mapEditorModeStore } from "../../Stores/MapEditorStore";
    import { highlightFullScreen } from "../../Stores/ActionsCamStore";
    import { inputFormFocusStore } from "../../Stores/UserInputStore";
    import { menuInputFocusStore } from "../../Stores/MenuInputFocusStore";
    import { isInRemoteConversation } from "../../Stores/StreamableCollectionStore";
    import { inLivekitStore, inJitsiStore, inBbbStore, requestedStatusStore } from "../../Stores/MediaStore";
    import { expressTrayStore } from "../../Stores/ExpressStore";
    import { LL } from "../../../i18n/i18n-svelte";
    import type { QuestProofCopy } from "../../../i18n/en-US/questsProof";
    import copyEn from "../../../i18n/en-US/questsProof";
    import QuestProof from "./QuestProof.svelte";
    import { questProofController } from "./QuestProofGate";
    let ready = false;
    let bottomClearance = 100;
    let reason: MessagePort | undefined;
    let channel: MessageChannel | undefined;
    let locked: UserInputManager | undefined;
    let previousSurface = "";
    onMount(() => {
        let readyTimer: ReturnType<typeof setTimeout> | undefined;
        const stopReady = gameSceneIsLoadedStore.subscribe((loaded) => {
            clearTimeout(readyTimer);
            ready = false;
            if (loaded)
                readyTimer = setTimeout(() => {
                    ready = true;
                }, 1500);
        });
        channel = new MessageChannel();
        reason = channel.port1;
        const obstacle = document.querySelector<HTMLElement>("[data-quest-proof-obstacle]");
        const measure = () => {
            bottomClearance =
                window.innerWidth > 600 ? 22 : obstacle ? Math.ceil(obstacle.getBoundingClientRect().height) + 16 : 100;
        };
        const observer = new ResizeObserver(measure);
        if (obstacle) observer.observe(obstacle);
        const layout = document.querySelector<HTMLElement>("#main-layout-main");
        if (layout) observer.observe(layout);
        measure();
        return () => {
            observer.disconnect();
            stopReady();
            clearTimeout(readyTimer);
        };
    });
    $: synchronizeInput($gameSceneStore?.userInputManager, $questProofController.surface, reason);
    function synchronizeInput(
        manager: UserInputManager | undefined,
        surface: string,
        controlReason: MessagePort | undefined
    ) {
        if (!controlReason) return;
        if (locked && (surface !== "log" || locked !== manager)) {
            locked.restoreControls(controlReason);
            locked = undefined;
        }
        if (manager && surface !== previousSurface && ["options", "card", "log"].includes(surface))
            manager.clearHeldMovement();
        previousSurface = surface;
        if (manager && surface === "log" && locked !== manager) {
            manager.clearHeldMovement();
            manager.disableControls(controlReason);
            locked = manager;
        }
    }
    function returnFocus() {
        document.querySelector<HTMLElement>('[data-testid="action-user"]')?.focus({ preventScroll: true });
    }
    onDestroy(() => {
        if (locked && reason) locked.restoreControls(reason);
        channel?.port1.close();
        channel?.port2.close();
    });
    // Existing focus stores only. No visualViewport or global keyboard/touch listeners.
    $: suppressed =
        !ready ||
        $chatVisibilityStore ||
        $modalVisibilityStore ||
        $menuVisiblilityStore ||
        !!$openedMenuStore ||
        $mapEditorVisibilityStore ||
        $mapEditorModeStore ||
        $highlightFullScreen ||
        $inputFormFocusStore ||
        $chatInputFocusStore ||
        $menuInputFocusStore ||
        $isInRemoteConversation ||
        $inLivekitStore ||
        $inJitsiStore ||
        $inBbbStore ||
        $requestedStatusStore === AvailabilityStatus.DO_NOT_DISTURB ||
        $expressTrayStore !== "closed";
    $: copy = translatedCopy($LL.questsProof);
    function translatedCopy(translations: { [K in keyof QuestProofCopy]: () => string }): QuestProofCopy {
        const translated = { ...copyEn };
        for (const key of Object.keys(copyEn) as Array<keyof QuestProofCopy>) translated[key] = translations[key]();
        return translated;
    }
</script>

<QuestProof controller={questProofController} {suppressed} {copy} {bottomClearance} {returnFocus} />
