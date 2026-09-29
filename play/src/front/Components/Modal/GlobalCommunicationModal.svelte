<script lang="ts" context="module">
    import type { GlobalMessageKind } from "../GlobalMessage/GlobalMessageComposer";

    // Reopening the composer brings back the tab used last time.
    let lastKind: GlobalMessageKind | undefined;
</script>

<script lang="ts">
    import { onDestroy } from "svelte";
    import { fly } from "svelte/transition";
    import { showModalGlobalComminucationVisibilityStore } from "../../Stores/ModalStore";
    import { displayedMegaphoneScreenStore, streamingMegaphoneStore } from "../../Stores/MediaStore";
    import { requestedMegaphoneStore } from "../../Stores/MegaphoneStore";
    import { userIsAdminStore } from "../../Stores/GameStore";
    import LL from "../../../i18n/i18n-svelte";
    import TextGlobalMessage from "../Menu/TextGlobalMessage.svelte";
    import AudioGlobalMessage from "../Menu/AudioGlobalMessage.svelte";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import ButtonClose from "../Input/ButtonClose.svelte";
    import LiveMessagePanel from "../GlobalMessage/LiveMessagePanel.svelte";
    import { renderGlobalTextMessage } from "../TypeMessage/renderGlobalTextMessage";
    import type { GlobalMessageTarget } from "../GlobalMessage/GlobalMessageComposer";
    import { availableKinds, initialKind, isBroadcastToWorld } from "../GlobalMessage/GlobalMessageComposer";
    import { IconCheck, IconMessageShare, IconMusicShare, IconSpeakerPhone } from "@wa-icons";

    /* eslint-disable svelte/no-at-html-tags */

    $: kinds = availableKinds($userIsAdminStore);
    let kind: GlobalMessageKind = initialKind(availableKinds($userIsAdminStore), $requestedMegaphoneStore, lastKind);
    // Rights can change while the composer is open (e.g. admin status arrives late): stay on an allowed tab.
    $: if (!kinds.includes(kind)) kind = initialKind(kinds, $requestedMegaphoneStore, lastKind);

    let target: GlobalMessageTarget = "room";
    let status: "editing" | "sending" | "sent" | "failed" = "editing";
    let sentKind: GlobalMessageKind = "text";
    let sentTarget: GlobalMessageTarget = "room";

    let textIsEmpty = true;
    let textOps: unknown[] = [];
    let showPreview = false;
    let audioHasFile = false;
    let handleSendText: { sendTextMessage(broadcast: boolean): boolean };
    let handleSendAudio: { sendAudioMessage(broadcast: boolean): Promise<boolean> };

    $: canSend = status !== "sending" && ((kind === "text" && !textIsEmpty) || (kind === "audio" && audioHasFile));
    $: previewHtml = showPreview && kind === "text" ? renderGlobalTextMessage(textOps) : "";

    // Tailwind's md: a centred dialog above it, a bottom sheet below.
    const isDesktop = window.matchMedia("(min-width: 768px)").matches;
    const targets: GlobalMessageTarget[] = ["room", "world"];

    const tabs: Record<GlobalMessageKind, { label: () => string; icon: typeof IconMessageShare }> = {
        text: { label: () => $LL.megaphone.modal.composer.tabText(), icon: IconMessageShare },
        audio: { label: () => $LL.megaphone.modal.composer.tabAudio(), icon: IconMusicShare },
        live: { label: () => $LL.megaphone.modal.composer.tabLive(), icon: IconSpeakerPhone },
    };

    function selectKind(next: GlobalMessageKind) {
        // Switching mid-send would unmount the form that is still uploading and mislabel the confirmation.
        if (next === kind || status === "sending") {
            return;
        }
        // Leaving the live tab while only previewing the camera: stop the preview. A running broadcast keeps going.
        if (kind === "live" && !$requestedMegaphoneStore) {
            streamingMegaphoneStore.set(false);
            displayedMegaphoneScreenStore.set(false);
        }
        kind = next;
        lastKind = next;
        status = "editing";
        showPreview = false;
        if (next === "text") {
            analyticsClient.openGlobalMessage();
        } else if (next === "audio") {
            analyticsClient.openGlobalAudio();
        }
    }

    function onTabKeyDown(event: KeyboardEvent) {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
            return;
        }
        const step = event.key === "ArrowRight" ? 1 : -1;
        const next = kinds[(kinds.indexOf(kind) + step + kinds.length) % kinds.length];
        selectKind(next);
        tabElements[next]?.focus();
        event.preventDefault();
    }
    const tabElements: Partial<Record<GlobalMessageKind, HTMLButtonElement>> = {};

    async function send(): Promise<void> {
        if (!canSend) {
            return;
        }
        // Capture what is being sent: the confirmation must describe this message, not the form's later state.
        const sendingKind = kind;
        const sendingTarget = target;
        const broadcastToWorld = isBroadcastToWorld(sendingTarget);
        status = "sending";
        let sent = false;
        if (sendingKind === "text") {
            analyticsClient.sendGlocalTextMessage();
            sent = handleSendText.sendTextMessage(broadcastToWorld);
        } else if (sendingKind === "audio") {
            analyticsClient.sendGlobalSoundMessage();
            sent = await handleSendAudio.sendAudioMessage(broadcastToWorld);
        }
        sentKind = sendingKind;
        sentTarget = sendingTarget;
        status = sent ? "sent" : "failed";
        showPreview = false;
    }

    function sendAnother() {
        status = "editing";
    }

    function close() {
        streamingMegaphoneStore.set(false);
        showModalGlobalComminucationVisibilityStore.set(false);
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            close();
        }
    }

    // Swipe the handle down to dismiss the sheet on phones.
    let dragStartY: number | undefined;
    let dragOffset = 0;
    function onHandlePointerDown(event: PointerEvent) {
        dragStartY = event.clientY;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
    function onHandlePointerMove(event: PointerEvent) {
        if (dragStartY === undefined) return;
        dragOffset = Math.max(0, event.clientY - dragStartY);
    }
    function onHandlePointerUp() {
        if (dragStartY === undefined) return;
        const shouldClose = dragOffset > 80;
        dragStartY = undefined;
        dragOffset = 0;
        if (shouldClose) {
            close();
        }
    }

    onDestroy(() => {
        displayedMegaphoneScreenStore.set(false);
    });
</script>

<svelte:window on:keydown={onKeyDown} />

<div
    class="absolute inset-0 z-[308] flex items-end md:items-center justify-center pointer-events-auto"
    data-testid="global-message-composer"
>
    <button
        type="button"
        class="absolute inset-0 m-0 p-0 w-full h-full bg-black/40 border-0 cursor-default"
        aria-label={$LL.megaphone.modal.composer.close()}
        tabindex="-1"
        on:click={close}
    />
    <div
        class="relative flex flex-col w-full md:max-w-xl max-h-[90dvh] md:max-h-[85vh] bg-contrast/90 backdrop-blur text-white rounded-t-2xl md:rounded-2xl shadow-2xl"
        style="padding-bottom: env(safe-area-inset-bottom); transform: translateY({dragOffset}px)"
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-message-composer-title"
        transition:fly={{ y: isDesktop ? 16 : 300, duration: 200 }}
    >
        <button
            type="button"
            class="md:hidden flex w-full shrink-0 justify-center pt-2 pb-1 m-0 bg-transparent touch-none"
            aria-label={$LL.megaphone.modal.composer.close()}
            on:pointerdown={onHandlePointerDown}
            on:pointermove={onHandlePointerMove}
            on:pointerup={onHandlePointerUp}
            on:pointercancel={onHandlePointerUp}
        >
            <span class="block h-1.5 w-12 rounded-full bg-white/40" aria-hidden="true" />
        </button>

        <header class="flex shrink-0 items-center justify-between gap-2 px-4 pt-1 md:pt-4 pb-2">
            <h2 id="global-message-composer-title" class="m-0 text-lg md:text-xl font-bold">
                {$LL.megaphone.modal.title()}
            </h2>
            <ButtonClose size="sm" on:click={close} />
        </header>

        {#if kinds.length > 1}
            <div
                class="mx-4 mb-3 flex shrink-0 gap-1 rounded-lg bg-white/10 p-1"
                role="tablist"
                aria-label={$LL.megaphone.modal.title()}
            >
                {#each kinds as tabKind (tabKind)}
                    <button
                        type="button"
                        role="tab"
                        id="global-message-tab-{tabKind}"
                        aria-selected={kind === tabKind}
                        aria-controls="global-message-panel"
                        tabindex={kind === tabKind ? 0 : -1}
                        disabled={status === "sending" && kind !== tabKind}
                        class="m-0 flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-sm font-bold transition-all {kind ===
                        tabKind
                            ? 'bg-white text-contrast'
                            : 'bg-transparent text-white hover:bg-white/10'}"
                        data-testid="global-message-tab-{tabKind}"
                        bind:this={tabElements[tabKind]}
                        on:click={() => selectKind(tabKind)}
                        on:keydown={onTabKeyDown}
                    >
                        <svelte:component this={tabs[tabKind].icon} font-size="18" />
                        {tabs[tabKind].label()}
                        {#if tabKind === "live" && $requestedMegaphoneStore}
                            <span class="h-2 w-2 rounded-full bg-danger" aria-hidden="true" />
                        {/if}
                    </button>
                {/each}
            </div>
        {/if}

        <div
            id="global-message-panel"
            class="flex-1 overflow-y-auto px-4 pb-4"
            role={kinds.length > 1 ? "tabpanel" : undefined}
            aria-labelledby={kinds.length > 1 ? `global-message-tab-${kind}` : undefined}
        >
            {#if kind === "live"}
                <LiveMessagePanel on:stopped={close} />
            {:else if status === "sent"}
                <div
                    class="flex flex-col items-center gap-3 py-6 text-center"
                    role="status"
                    data-testid="global-message-sent"
                >
                    <span class="flex h-12 w-12 items-center justify-center rounded-full bg-success/80">
                        <IconCheck font-size="28" />
                    </span>
                    <p class="m-0 text-lg font-bold">
                        {sentKind === "audio"
                            ? $LL.megaphone.modal.composer.sentAudio()
                            : $LL.megaphone.modal.composer.sentText()}
                    </p>
                    <p class="m-0 text-sm opacity-80">
                        {sentTarget === "world"
                            ? $LL.megaphone.modal.composer.sentToWorld()
                            : $LL.megaphone.modal.composer.sentToRoom()}
                    </p>
                    <div class="flex w-full gap-2 pt-2">
                        <button class="btn flex-1 justify-center bg-white/10 hover:bg-white/20" on:click={sendAnother}>
                            {$LL.megaphone.modal.composer.sendAnother()}
                        </button>
                        <button class="btn btn-light flex-1 justify-center" on:click={close}>
                            {$LL.megaphone.modal.composer.done()}
                        </button>
                    </div>
                </div>
            {:else}
                <div id="active-globalMessage" class="flex flex-col gap-3">
                    {#if kind === "text"}
                        <div id="content-textMessage" class:hidden={showPreview}>
                            <TextGlobalMessage
                                bind:handleSending={handleSendText}
                                bind:isEmpty={textIsEmpty}
                                bind:ops={textOps}
                            />
                        </div>
                        {#if showPreview}
                            <div class="flex flex-col gap-2" data-testid="global-message-preview">
                                <p class="m-0 text-xs opacity-70">{$LL.megaphone.modal.composer.previewHint()}</p>
                                <!-- Same look as the popup people receive (TypeMessage/TextMessage.svelte). -->
                                <div class="bg-contrast/85 rounded flex gap-3 py-3 pl-5 pr-3 shadow-xl">
                                    <div class="mt-3 text-xl" aria-hidden="true">💬</div>
                                    <div class="content-text-message flex max-h-60 w-full overflow-auto">
                                        {@html previewHtml}
                                    </div>
                                </div>
                            </div>
                        {/if}
                        <button
                            type="button"
                            class="btn btn-sm self-start bg-white/10 hover:bg-white/20"
                            disabled={textIsEmpty}
                            on:click={() => (showPreview = !showPreview)}
                        >
                            {showPreview
                                ? $LL.megaphone.modal.composer.editMessage()
                                : $LL.megaphone.modal.composer.preview()}
                        </button>
                    {:else}
                        <div id="content-soundMessage">
                            <AudioGlobalMessage bind:handleSending={handleSendAudio} bind:hasFile={audioHasFile} />
                        </div>
                    {/if}

                    <fieldset class="m-0 flex flex-col gap-2 border-0 p-0">
                        <legend class="mb-2 p-0 text-sm font-bold">{$LL.megaphone.modal.composer.sendTo()}</legend>
                        <div class="grid grid-cols-2 gap-2">
                            {#each targets as option (option)}
                                <label
                                    class="flex cursor-pointer flex-col gap-0.5 rounded-lg border border-solid p-3 transition-all {target ===
                                    option
                                        ? 'border-white bg-white/15'
                                        : 'border-white/20 hover:bg-white/10'}"
                                >
                                    <input
                                        type="radio"
                                        class="sr-only"
                                        name="global-message-target"
                                        value={option}
                                        bind:group={target}
                                        disabled={status === "sending"}
                                        data-testid="global-message-target-{option}"
                                    />
                                    <span class="text-sm font-bold">
                                        {option === "world"
                                            ? $LL.megaphone.modal.composer.wholeWorld()
                                            : $LL.megaphone.modal.composer.thisRoom()}
                                    </span>
                                    <span class="text-xs opacity-70">
                                        {option === "world"
                                            ? $LL.megaphone.modal.composer.wholeWorldHint()
                                            : $LL.megaphone.modal.composer.thisRoomHint()}
                                    </span>
                                </label>
                            {/each}
                        </div>
                    </fieldset>

                    {#if status === "failed"}
                        <p class="m-0 text-sm text-danger-800" role="alert">
                            {$LL.megaphone.modal.composer.sendFailed()}
                        </p>
                    {/if}

                    <button
                        class="btn btn-light w-full justify-center"
                        data-testid="global-message-send"
                        disabled={!canSend}
                        on:click|preventDefault={send}
                    >
                        {#if status === "sending"}
                            {$LL.megaphone.modal.composer.sending()}
                        {:else}
                            {target === "world"
                                ? $LL.megaphone.modal.composer.sendToWorld()
                                : $LL.megaphone.modal.composer.sendToRoom()}
                        {/if}
                    </button>
                </div>
            {/if}
        </div>
    </div>
</div>
