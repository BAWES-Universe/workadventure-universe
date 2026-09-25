<script lang="ts" context="module">
    export type ExpressSent = { kind: "emote"; emoji: string } | { kind: "say" | "think" };
</script>

<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";
    import { get } from "svelte/store";
    import { cubicOut } from "svelte/easing";
    import type { TransitionConfig } from "svelte/transition";
    import type { Action } from "svelte/action";
    import type { EmojiClickEvent } from "emoji-picker-element/shared";
    import {
        emoteDataStore,
        emoteMenuSubCurrentEmojiSelectedStore,
        displayEmote,
        isEmoteIndex,
        quickPhrasesStore,
    } from "../../../Stores/EmoteStore";
    import { QUICK_PHRASE_KEYS, QUICK_PHRASE_MAX_LENGTH } from "../../../Stores/Utils/quickPhraseSchema";
    import { expressTrayOpenOptions, expressTrayStore } from "../../../Stores/ExpressStore";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import { showFloatingUi } from "../../../Utils/svelte-floatingui-show";
    import LazyEmote from "../../EmoteMenu/LazyEmote.svelte";
    import { availabilityStatusStore } from "../../../Stores/MediaStore";
    import { inputFormFocusStore } from "../../../Stores/UserInputStore";
    import { popupJustClosed } from "../../../Phaser/Game/Say/SayManager";
    import type { SayType } from "../../../Phaser/Game/Say/sendSay";
    import { SAY_MAX_LENGTH, sayTypeForcedByStatus, sendSayBubble } from "../../../Phaser/Game/Say/sendSay";
    import LL from "../../../../i18n/i18n-svelte";
    import { IconCheck, IconPencil, IconSend } from "@wa-icons";

    /** Whether this room allows say and think bubbles. Emotes are always available. */
    export let sayEnabled = true;

    const dispatch = createEventDispatcher<{ close: { sent?: ExpressSent } }>();

    let chosenType: SayType = "say";
    let text = "";
    let input: HTMLInputElement | undefined;

    $: forcedType = sayTypeForcedByStatus($availabilityStatusStore);
    $: effectiveType = forcedType ?? chosenType;
    $: remaining = SAY_MAX_LENGTH - text.length;
    $: canSend = text.trim().length > 0;
    $: emotes = [...$emoteDataStore.entries()].sort(([a], [b]) => a - b);
    $: phrases = $quickPhrasesStore.map((phrase) =>
        "key" in phrase ? $LL.say.quickPhrases[phrase.key]() : phrase.text
    );

    $: editing = $expressTrayStore === "editing";

    // The phrases only show when all four fit on one line, measured with the real (translated or custom) text
    // on an invisible copy of the row.
    let phrasesFit = true;
    const measureFit: Action<HTMLElement, string[]> = (node) => {
        const measure = () => {
            phrasesFit = node.scrollWidth <= node.clientWidth + 1;
        };
        const remeasure = () => {
            tick()
                .then(measure)
                .catch((e) => console.error(e));
        };
        const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : undefined;
        resizeObserver?.observe(node);
        remeasure();
        return { update: remeasure, destroy: () => resizeObserver?.disconnect() };
    };

    const finePointer = typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches;

    onMount(() => {
        const options = get(expressTrayOpenOptions);
        if (options.think) {
            chosenType = "think";
        }
        // On desktop, or when opened from a keyboard (Enter), type straight away.
        // On touch screens, don't pop the keyboard until the field is tapped.
        if ((finePointer || options.focusInput) && sayEnabled && !editing) {
            input?.focus();
        }
        // Capture phase: runs before the game's keyboard shortcuts, which listen further down the chain.
        window.addEventListener("keydown", typeIntoInput, true);
        window.addEventListener("keydown", onWindowKeydown, true);
        return () => {
            window.removeEventListener("keydown", typeIntoInput, true);
            window.removeEventListener("keydown", onWindowKeydown, true);
        };
    });

    function deepActiveElement(): Element | null {
        let active = document.activeElement;
        // The emoji picker keeps its search field in a shadow root.
        while (active?.shadowRoot?.activeElement) {
            active = active.shadowRoot.activeElement;
        }
        return active;
    }

    function isTextField(element: Element | null): boolean {
        return (
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            element instanceof HTMLSelectElement ||
            (element instanceof HTMLElement && element.isContentEditable)
        );
    }

    /**
     * While the tray is open, a printable key typed with the text field unfocused (e.g. after clicking the tray)
     * goes into the field instead of reaching the game, where letters are shortcuts (E opens the map editor).
     */
    function typeIntoInput(event: KeyboardEvent) {
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
        if (isTextField(deepActiveElement())) return;
        // No letter reaches the game while the tray is open, even in edit mode or when say is off.
        event.preventDefault();
        event.stopPropagation();
        if (editing || !sayEnabled || !input) return;
        if (text.length < SAY_MAX_LENGTH) {
            text += event.key;
        }
        input.focus();
        tick()
            .then(() => input?.setSelectionRange(text.length, text.length))
            .catch((e) => console.error(e));
    }

    onDestroy(() => {
        closePicker();
        // Firefox doesn't fire "blur" when the focused input is removed from the DOM.
        inputFormFocusStore.set(false);
    });

    function close(sent?: ExpressSent) {
        dispatch("close", { sent });
    }

    function vibrate() {
        try {
            navigator.vibrate?.(8);
        } catch {
            // Not supported: no haptics.
        }
    }

    // --- Edit mode: swap emotes with the emoji picker and rename phrases. ---
    let closePickerFn: (() => void) | undefined;
    let pickingSlot: number | undefined;
    let editingPhrase: number | undefined;
    let phraseDraft = "";

    function closePicker() {
        closePickerFn?.();
        closePickerFn = undefined;
        pickingSlot = undefined;
    }

    function toggleEditing() {
        closePicker();
        editingPhrase = undefined;
        if (editing) {
            expressTrayStore.open();
        } else {
            expressTrayStore.edit();
        }
    }

    function pickEmote(index: number, anchor: HTMLElement) {
        if (pickingSlot === index) {
            closePicker();
            return;
        }
        closePicker();
        editingPhrase = undefined;
        pickingSlot = index;
        // Same flow as the action bar's emoji menu: the picker replaces the selected slot.
        emoteMenuSubCurrentEmojiSelectedStore.select(index);
        closePickerFn = showFloatingUi(
            anchor,
            LazyEmote,
            {
                onEmojiClick: (event: EmojiClickEvent) => {
                    const emojiObj = event.detail.emoji;
                    emoteDataStore.pushNewEmoji({
                        name: "annotation" in emojiObj ? emojiObj.annotation : emojiObj.name,
                        emoji: event.detail.unicode ?? "",
                    });
                    vibrate();
                    closePicker();
                },
                onClose: closePicker,
            },
            { placement: "top" },
            12,
            true
        );
    }

    function startEditingPhrase(index: number) {
        closePicker();
        const phrase = $quickPhrasesStore[index];
        phraseDraft = phrase && "text" in phrase ? phrase.text : phrases[index] ?? "";
        editingPhrase = index;
    }

    function savePhrase() {
        if (editingPhrase === undefined) return;
        const index = editingPhrase;
        const phrase = $quickPhrasesStore[index];
        const unchangedDefault = phrase && "key" in phrase && phraseDraft.trim() === phrases[index];
        if (!unchangedDefault) {
            quickPhrasesStore.setPhrase(index, phraseDraft);
        }
        editingPhrase = undefined;
    }

    function onPhraseKeydown(event: KeyboardEvent) {
        if (event.key === "Enter" && !event.isComposing) {
            event.preventDefault();
            savePhrase();
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            editingPhrase = undefined;
        }
    }

    const focusOnMount: Action<HTMLInputElement> = (node) => {
        node.focus();
        node.select();
    };

    function onEmoteClick(event: MouseEvent, index: number, emoji: string) {
        if (editing) {
            pickEmote(index, event.currentTarget as HTMLElement);
        } else {
            playEmote(index, emoji);
        }
    }

    function playEmote(index: number, emoji: string) {
        if (!isEmoteIndex(index)) return;
        displayEmote(index, "express_tray");
        vibrate();
        close({ kind: "emote", emoji });
    }

    function send() {
        if (!canSend) return;
        sendSayBubble(text, effectiveType, "express_tray");
        // The Enter key that sent this will be released after the tray closes:
        // don't let it reopen the say popup.
        popupJustClosed();
        vibrate();
        const kind = effectiveType;
        text = "";
        input?.blur();
        close({ kind });
    }

    function sendPhrase(index: number) {
        const phrase = phrases[index];
        if (!phrase) return;
        // A phrase is a Say bubble, unless your status only allows thinking.
        const type = forcedType ?? "say";
        sendSayBubble(phrase, type, "express_tray");
        analyticsClient.quickPhraseSent(index);
        vibrate();
        close({ kind: type });
    }

    function onInputKeydown(event: KeyboardEvent) {
        if (event.key === "Enter" && !event.isComposing) {
            event.preventDefault();
            if (canSend) {
                send();
            } else {
                // Enter on an empty field closes, so Enter alone toggles the tray.
                // The released Enter must not reopen it.
                popupJustClosed();
                close();
            }
        } else if (event.key === "Escape") {
            event.preventDefault();
            close();
        }
    }

    function onWindowKeydown(event: KeyboardEvent) {
        if (event.key !== "Escape") return;
        // Runs in the capture phase, before the emoji picker's own Escape handler: while the picker is open,
        // this Escape is the picker's (it closes it), so it doesn't also leave edit mode. The next one does.
        if (closePickerFn) return;
        // The text fields handle their own Escape (cancel a phrase edit, close the tray).
        if (isTextField(deepActiveElement())) return;
        if (editing) {
            expressTrayStore.open();
        } else {
            close();
        }
    }

    // Swipe down anywhere on the tray (except the text field) to dismiss it.
    let dragStartY: number | undefined;
    let dragOffset = 0;
    function onPointerDown(event: PointerEvent) {
        const target = event.target as HTMLElement | null;
        if (target?.closest("input")) return;
        dragStartY = event.clientY;
    }
    function onPointerMove(event: PointerEvent) {
        if (dragStartY === undefined) return;
        dragOffset = Math.max(0, event.clientY - dragStartY);
    }
    function onPointerUp() {
        if (dragStartY === undefined) return;
        const shouldClose = dragOffset > 56;
        dragStartY = undefined;
        dragOffset = 0;
        if (shouldClose) close();
    }

    /** Grows out of the button, like a speech bubble unfolding. */
    function unfold(_node: Element, { duration = 260 }: { duration?: number } = {}): TransitionConfig {
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        return {
            duration: reduced ? 0 : duration,
            easing: cubicOut,
            css: (t) => `opacity: ${t}; transform: translateY(${(1 - t) * 12}px) scale(${0.92 + 0.08 * t});`,
        };
    }
</script>

<svelte:window on:pointermove={onPointerMove} on:pointerup={onPointerUp} />

<!-- The tray only stops pointer events from reaching the map and handles swipe-to-dismiss. -->
<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
    class="express-tray absolute bottom-full right-0 mb-2 w-[min(22rem,calc(100vw-1.5rem))] origin-bottom-right rounded-lg p-3 pointer-events-auto select-none"
    style:transform={dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined}
    style:opacity={dragOffset > 0 ? Math.max(0.4, 1 - dragOffset / 160) : undefined}
    role="dialog"
    aria-label={$LL.say.express.button()}
    data-testid="express-tray"
    transition:unfold
    on:pointerdown|stopPropagation={onPointerDown}
    on:click|stopPropagation
    on:wheel|stopPropagation
>
    <div class="relative mb-2 flex h-7 items-center justify-center">
        {#if editing}
            <p class="m-0 text-sm font-semibold text-white" data-testid="express-edit-title">
                {$LL.say.express.editTitle()}
            </p>
        {:else}
            <div class="h-1 w-9 rounded-full bg-white/20" aria-hidden="true" />
        {/if}
        <button
            type="button"
            class="edit-toggle absolute end-0 top-0 m-0 flex h-7 w-7 items-center justify-center rounded-lg p-0 text-white/60"
            class:is-editing={editing}
            aria-pressed={editing}
            aria-label={editing ? $LL.say.express.done() : $LL.say.express.edit()}
            title={editing ? $LL.say.express.done() : $LL.say.express.edit()}
            data-testid="express-edit"
            on:click={toggleEditing}
        >
            {#if editing}
                <IconCheck font-size="16" />
            {:else}
                <IconPencil font-size="15" />
            {/if}
        </button>
    </div>

    {#if editing}
        <p class="mb-2 mt-0 px-1 text-center text-xs text-white/55">{$LL.say.express.editHint()}</p>
    {/if}

    {#if sayEnabled && !editing}
        <div
            class="composer flex items-center gap-1.5 rounded-xl bg-white/[0.07] p-1 ring-1 ring-white/10 transition-shadow focus-within:ring-2"
            class:think={effectiveType === "think"}
        >
            <div
                class="relative flex shrink-0 rounded-lg bg-black/25 p-0.5"
                role="radiogroup"
                aria-label="{$LL.say.express.say()} / {$LL.say.express.think()}"
                title={forcedType === "say"
                    ? $LL.say.express.forcedSay()
                    : forcedType === "think"
                    ? $LL.say.express.forcedThink()
                    : undefined}
            >
                <span
                    class="toggle-thumb absolute top-0.5 bottom-0.5 w-9 rounded-md"
                    class:is-think={effectiveType === "think"}
                    aria-hidden="true"
                />
                <button
                    type="button"
                    role="radio"
                    aria-checked={effectiveType === "say"}
                    aria-label={$LL.say.express.say()}
                    title={$LL.say.express.sayHint()}
                    class="relative z-[1] h-9 w-9 rounded-md p-0 m-0 text-lg leading-none transition-opacity"
                    class:opacity-40={forcedType === "think"}
                    disabled={forcedType !== undefined}
                    data-testid="express-say-toggle"
                    on:click={() => (chosenType = "say")}>💬</button
                >
                <button
                    type="button"
                    role="radio"
                    aria-checked={effectiveType === "think"}
                    aria-label={$LL.say.express.think()}
                    title={$LL.say.express.thinkHint()}
                    class="relative z-[1] h-9 w-9 rounded-md p-0 m-0 text-lg leading-none transition-opacity"
                    class:opacity-40={forcedType === "say"}
                    disabled={forcedType !== undefined}
                    data-testid="express-think-toggle"
                    on:click={() => (chosenType = "think")}>💭</button
                >
            </div>

            <input
                bind:this={input}
                bind:value={text}
                type="text"
                maxlength={SAY_MAX_LENGTH}
                enterkeyhint="send"
                autocomplete="off"
                class="min-w-0 flex-1 border-none bg-transparent px-1.5 py-2 text-base text-white placeholder:text-white/40 focus:outline-none focus:ring-0"
                placeholder={$LL.say.express.placeholder()}
                aria-label={effectiveType === "say" ? $LL.say.express.say() : $LL.say.express.think()}
                data-testid="express-input"
                on:focus={() => inputFormFocusStore.set(true)}
                on:blur={() => inputFormFocusStore.set(false)}
                on:keydown|stopPropagation={onInputKeydown}
                on:keyup|stopPropagation
            />

            {#if remaining <= 20}
                <span class="shrink-0 tabular-nums text-xs text-white/50" aria-live="polite">{remaining}</span>
            {/if}

            <button
                type="button"
                class="send-button m-0 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg p-0 text-white"
                class:is-ready={canSend}
                disabled={!canSend}
                aria-label={$LL.say.express.send()}
                title={finePointer ? $LL.say.express.enterToSend() : undefined}
                data-testid="express-send"
                on:click={send}
            >
                <IconSend font-size="18" class="rtl:-scale-x-100" />
            </button>
        </div>
        {#if forcedType !== undefined}
            <p class="mt-1.5 px-1 text-xs text-white/50" data-testid="express-forced-hint">
                {forcedType === "say" ? $LL.say.express.forcedSay() : $LL.say.express.forcedThink()}
            </p>
        {/if}

        <!-- Invisible copy of the phrase row, used to check that the four phrases fit on one line. -->
        <div
            use:measureFit={phrases}
            class="phrase-row pointer-events-none invisible absolute inset-x-3 top-0 flex gap-1.5 overflow-hidden"
            aria-hidden="true"
        >
            {#each phrases as phrase, i (i)}
                <span class="phrase-chip">{phrase}</span>
            {/each}
        </div>

        {#if phrasesFit}
            <div
                class="phrase-row mt-2.5 flex gap-1.5"
                role="group"
                aria-label={$LL.say.express.phrases()}
                data-testid="express-phrases"
            >
                {#each phrases as phrase, i (i)}
                    <button
                        type="button"
                        class="phrase-chip m-0"
                        style="--i: {i}"
                        data-testid="express-phrase-{i}"
                        on:click={() => sendPhrase(i)}>{phrase}</button
                    >
                {/each}
            </div>
        {/if}
    {/if}

    {#if sayEnabled && editing}
        <div class="grid grid-cols-2 gap-1.5" role="group" aria-label={$LL.say.express.phrases()}>
            {#each phrases as phrase, i (i)}
                {#if editingPhrase === i}
                    <input
                        use:focusOnMount
                        bind:value={phraseDraft}
                        type="text"
                        maxlength={QUICK_PHRASE_MAX_LENGTH}
                        enterkeyhint="done"
                        autocomplete="off"
                        class="phrase-chip phrase-input m-0 min-w-0 border-none text-center text-white focus:outline-none focus:ring-0"
                        placeholder={$LL.say.quickPhrases[QUICK_PHRASE_KEYS[i]]()}
                        aria-label={$LL.say.express.editPhrase({ phrase })}
                        data-testid="express-phrase-input-{i}"
                        on:focus={() => inputFormFocusStore.set(true)}
                        on:blur={() => {
                            inputFormFocusStore.set(false);
                            savePhrase();
                        }}
                        on:keydown|stopPropagation={onPhraseKeydown}
                        on:keyup|stopPropagation
                    />
                {:else}
                    <button
                        type="button"
                        class="phrase-chip is-editable m-0 min-w-0"
                        aria-label={$LL.say.express.editPhrase({ phrase })}
                        data-testid="express-phrase-{i}"
                        on:click={() => startEditingPhrase(i)}
                    >
                        <span class="truncate">{phrase}</span>
                        <IconPencil font-size="12" class="shrink-0 opacity-60" />
                    </button>
                {/if}
            {/each}
        </div>
    {/if}

    <div
        class="mt-3 grid grid-cols-6 gap-1"
        class:mt-0={!sayEnabled && !editing}
        class:is-editing={editing}
        role="group"
        aria-label={$LL.say.express.emotes()}
        data-testid="express-emotes"
    >
        {#each emotes as [index, emote], i (index)}
            <button
                type="button"
                class="emote-button group relative m-0 flex aspect-square items-center justify-center rounded-xl p-0"
                class:is-picking={pickingSlot === index}
                style="--i: {i}"
                aria-label={editing
                    ? $LL.say.express.changeEmote({ emoji: emote.name })
                    : $LL.say.express.emote({ emoji: emote.name })}
                data-testid="express-emote-{index}"
                on:click={(event) => onEmoteClick(event, index, emote.emoji)}
            >
                <span class="emote-glyph text-[1.75rem] leading-none">{emote.emoji}</span>
                {#if editing}
                    <span
                        class="edit-badge absolute -top-0.5 end-0 flex h-4 w-4 items-center justify-center rounded-full"
                    >
                        <IconPencil font-size="9" />
                    </span>
                {:else if finePointer}
                    <kbd
                        class="absolute bottom-0.5 end-1 font-sans text-[0.625rem] font-semibold text-white/35 group-hover:text-white/70"
                        >{index}</kbd
                    >
                {/if}
            </button>
        {/each}
    </div>
</div>

<style lang="scss">
    .express-tray {
        /* Express has its own surface, a blue gradient with a purple glow, so it stands out from the action bar. */
        background: linear-gradient(160deg, rgba(38, 52, 82, 0.92), rgba(27, 42, 65, 0.94));
        backdrop-filter: blur(18px) saturate(140%);
        -webkit-backdrop-filter: blur(18px) saturate(140%);
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1px rgba(167, 139, 250, 0.25),
            0 18px 48px -12px rgba(0, 0, 0, 0.55), 0 0 28px 2px rgba(134, 41, 252, 0.4);
        touch-action: none;
    }

    .composer:focus-within {
        --tw-ring-color: rgba(134, 41, 252, 0.7);
    }
    .composer.think:focus-within {
        --tw-ring-color: rgba(65, 86, 246, 0.7);
    }

    .toggle-thumb {
        left: 0.125rem;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 4px 14px -4px rgba(134, 41, 252, 0.8);
        transition: transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .toggle-thumb.is-think {
        transform: translateX(2.25rem);
    }
    :global([dir="rtl"]) .toggle-thumb {
        left: auto;
        right: 0.125rem;
    }
    :global([dir="rtl"]) .toggle-thumb.is-think {
        transform: translateX(-2.25rem);
    }

    .send-button {
        background: rgba(255, 255, 255, 0.08);
        opacity: 0.45;
        transform: scale(0.9);
        transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 150ms ease, background 150ms ease;
    }
    .send-button.is-ready {
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 6px 18px -6px rgba(134, 41, 252, 0.9);
        opacity: 1;
        transform: scale(1);
        cursor: pointer;
    }
    .send-button.is-ready:active {
        transform: scale(0.9);
    }

    .phrase-chip {
        display: inline-flex;
        flex: 1 1 0%;
        align-items: center;
        justify-content: center;
        height: 2.25rem;
        padding: 0 0.75rem;
        border-radius: 9999px;
        white-space: nowrap;
        font-size: 0.875rem;
        font-weight: 500;
        line-height: 1;
        color: rgba(255, 255, 255, 0.92);
        background: rgba(255, 255, 255, 0.07);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
    }
    button.phrase-chip {
        cursor: pointer;
        transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1), background 150ms ease, box-shadow 150ms ease;
        animation: emote-in 360ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
        animation-delay: calc(var(--i) * 28ms + 40ms);
    }
    button.phrase-chip:hover,
    button.phrase-chip:focus-visible {
        background: linear-gradient(135deg, rgba(134, 41, 252, 0.35), rgba(65, 86, 246, 0.35));
        box-shadow: 0 0 0 1px rgba(134, 41, 252, 0.6) inset, 0 6px 16px -8px rgba(134, 41, 252, 0.8);
    }
    button.phrase-chip:active {
        transform: scale(0.94);
        transition-duration: 80ms;
    }

    .edit-toggle {
        cursor: pointer;
        transition: background 150ms ease, color 150ms ease, transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .edit-toggle:hover,
    .edit-toggle:focus-visible {
        color: white;
        background: rgba(255, 255, 255, 0.1);
    }
    .edit-toggle.is-editing {
        color: white;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 4px 14px -4px rgba(134, 41, 252, 0.8);
    }
    .edit-toggle:active {
        transform: scale(0.9);
    }

    .phrase-chip.is-editable {
        gap: 0.375rem;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.22) inset;
        background: rgba(255, 255, 255, 0.05);
        border: 0;
    }
    .phrase-input {
        font-size: 1rem;
        background: rgba(0, 0, 0, 0.25);
        box-shadow: 0 0 0 2px rgba(134, 41, 252, 0.75) inset;
    }

    .edit-badge {
        color: white;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 2px 6px -1px rgba(0, 0, 0, 0.5);
    }
    .is-editing .emote-button {
        background: rgba(255, 255, 255, 0.05);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.14) inset;
    }
    .is-editing .emote-glyph {
        animation: jiggle 280ms ease-in-out infinite alternate;
        animation-delay: calc(var(--i) * -70ms);
    }
    .emote-button.is-picking {
        background: linear-gradient(135deg, rgba(134, 41, 252, 0.4), rgba(65, 86, 246, 0.4));
        box-shadow: 0 0 0 2px rgba(134, 41, 252, 0.85) inset;
    }
    .is-editing .emote-button.is-picking .emote-glyph {
        animation: none;
        transform: scale(1.12);
    }
    @keyframes jiggle {
        from {
            transform: rotate(-4deg);
        }
        to {
            transform: rotate(4deg);
        }
    }

    .emote-button {
        cursor: pointer;
        transition: background 150ms ease;
        animation: emote-in 360ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
        animation-delay: calc(var(--i) * 28ms + 60ms);
    }
    .emote-button:hover,
    .emote-button:focus-visible {
        background: rgba(255, 255, 255, 0.09);
    }
    .emote-glyph {
        display: inline-block;
        transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
        filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.35));
    }
    .emote-button:hover .emote-glyph {
        transform: translateY(-3px) scale(1.18) rotate(-6deg);
    }
    .emote-button:active .emote-glyph {
        transform: scale(0.82);
        transition-duration: 80ms;
    }

    @keyframes emote-in {
        from {
            opacity: 0;
            transform: translateY(8px) scale(0.6);
        }
        to {
            opacity: 1;
            transform: none;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .emote-button,
        .is-editing .emote-glyph,
        .edit-toggle,
        button.phrase-chip,
        .toggle-thumb,
        .send-button,
        .emote-glyph {
            animation: none;
            transition: none;
        }
    }
</style>
