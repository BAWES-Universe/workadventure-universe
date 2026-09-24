<script lang="ts" context="module">
    export type ExpressSent = { kind: "emote"; emoji: string } | { kind: "say" | "think" };
</script>

<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import { cubicOut } from "svelte/easing";
    import type { TransitionConfig } from "svelte/transition";
    import { emoteDataStore, displayEmote, isEmoteIndex } from "../../../Stores/EmoteStore";
    import { availabilityStatusStore } from "../../../Stores/MediaStore";
    import { inputFormFocusStore } from "../../../Stores/UserInputStore";
    import { popupJustClosed } from "../../../Phaser/Game/Say/SayManager";
    import type { SayType } from "../../../Phaser/Game/Say/sendSay";
    import { SAY_MAX_LENGTH, sayTypeForcedByStatus, sendSayBubble } from "../../../Phaser/Game/Say/sendSay";
    import LL from "../../../../i18n/i18n-svelte";
    import { IconSend } from "@wa-icons";

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

    const finePointer = typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches;

    onMount(() => {
        // On desktop, type straight away. On touch screens, don't pop the keyboard until the field is tapped.
        if (finePointer && sayEnabled) {
            input?.focus();
        }
    });

    onDestroy(() => {
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

    function onInputKeydown(event: KeyboardEvent) {
        if (event.key === "Enter" && !event.isComposing) {
            event.preventDefault();
            send();
        } else if (event.key === "Escape") {
            event.preventDefault();
            close();
        }
    }

    function onWindowKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
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

<svelte:window on:keydown={onWindowKeydown} on:pointermove={onPointerMove} on:pointerup={onPointerUp} />

<!-- The tray only stops pointer events from reaching the map and handles swipe-to-dismiss. -->
<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
    class="express-tray absolute bottom-full right-0 mb-2 w-[min(22rem,calc(100vw-1.5rem))] origin-bottom-right rounded-2xl p-3 pointer-events-auto select-none"
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
    <div class="mx-auto mb-3 h-1 w-9 rounded-full bg-white/20 mobile:block hidden" aria-hidden="true" />

    {#if sayEnabled}
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
    {/if}

    <div
        class="mt-3 grid grid-cols-6 gap-1"
        class:mt-0={!sayEnabled}
        role="group"
        aria-label={$LL.say.express.emotes()}
        data-testid="express-emotes"
    >
        {#each emotes as [index, emote], i (index)}
            <button
                type="button"
                class="emote-button group relative m-0 flex aspect-square items-center justify-center rounded-xl p-0"
                style="--i: {i}"
                aria-label={$LL.say.express.emote({ emoji: emote.name })}
                data-testid="express-emote-{index}"
                on:click={() => playEmote(index, emote.emoji)}
            >
                <span class="emote-glyph text-[1.75rem] leading-none">{emote.emoji}</span>
                {#if finePointer}
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
        background: linear-gradient(160deg, rgba(38, 52, 82, 0.92), rgba(27, 42, 65, 0.94));
        backdrop-filter: blur(18px) saturate(140%);
        -webkit-backdrop-filter: blur(18px) saturate(140%);
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1px rgba(255, 255, 255, 0.07),
            0 18px 48px -12px rgba(0, 0, 0, 0.55), 0 0 40px -18px rgba(134, 41, 252, 0.6);
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
        .toggle-thumb,
        .send-button,
        .emote-glyph {
            animation: none;
            transition: none;
        }
    }
</style>
