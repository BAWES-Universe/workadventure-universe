<script lang="ts">
    import { fly } from "svelte/transition";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { RING_MS, incomingRingStore, ringClockStore, ringStore, ringToastsStore } from "../../Stores/RingStore";
    import type { RingToast } from "../../Stores/RingStore";
    import FriendAvatar from "./FriendAvatar.svelte";
    import { goToPersonRoom, walkToPerson } from "./PersonNavigation";
    import { IconBellRinging, IconCheck, IconInfoCircle, IconMapPin, IconSend } from "@wa-icons";

    /**
     * Over the game, at the top: a friend ringing you (Come over / Not now, 30 seconds, a ring around their face counts
     * down), and one-line news about the rings you made ("Sara came over").
     */

    // The ring around the face: a circle whose stroke empties as the time runs out.
    const RADIUS = 27;
    const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

    $: card = $incomingRingStore;
    $: total = card?.expiresInMs || RING_MS;
    $: left = card ? Math.max(0, total - ($ringClockStore - card.receivedAt)) : 0;
    $: seconds = Math.ceil(left / 1000);

    function currentRoomUrl(): string | undefined {
        try {
            return gameManager.getCurrentGameScene().roomUrl;
        } catch {
            return undefined;
        }
    }

    $: here = card ? card.playUri === currentRoomUrl() : false;
    $: place = card
        ? here
            ? $LL.chat.friends.inThisRoom()
            : [card.roomName, card.worldName || card.universeName].filter(Boolean).join(" · ")
        : "";

    // A short sound when a ring arrives, as for a new message (it follows the notification sound setting).
    let lastRingId: string | undefined;
    $: if (card && card.ringId !== lastRingId) {
        lastRingId = card.ringId;
        try {
            gameManager.getCurrentGameScene().playSound("new-message");
        } catch (e) {
            console.warn("Ring: could not play the sound", e);
        }
    }

    let answering = false;
    function setAnswering(value: boolean) {
        answering = value;
    }
    async function comeOver() {
        if (answering) return;
        answering = true;
        try {
            const target = await ringStore.accept();
            if (!target) return;
            const person = { uuid: target.callerUuid, playUri: target.playUri };
            if (target.playUri === currentRoomUrl()) walkToPerson(person);
            else goToPersonRoom(person);
        } finally {
            setAnswering(false);
        }
    }

    function notNow() {
        ringStore.decline().catch((e) => console.error(e));
    }

    function toastText(toast: RingToast): string {
        return $LL.chat.friends.ring.toast[toast.kind]({ userName: toast.name, minutes: toast.minutes ?? 0 });
    }
</script>

<div
    class="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+8px)] z-[700] flex flex-col items-center gap-2 px-2 md:top-[88px]"
    data-testid="ringOverlay"
>
    {#if card}
        {#key card.ringId}
            <section
                class="ring-card pointer-events-auto flex w-full max-w-[400px] flex-col gap-3 rounded-[20px] p-3 text-white"
                role="alertdialog"
                aria-labelledby="ring-card-title"
                aria-describedby="ring-card-place"
                data-testid="ringCard"
                transition:fly={{ y: -24, duration: 220 }}
            >
                <div class="flex min-w-0 items-center gap-3">
                    <span class="relative grid h-[60px] w-[60px] shrink-0 place-items-center">
                        <svg class="absolute inset-0 -rotate-90" viewBox="0 0 60 60" aria-hidden="true">
                            <circle
                                cx="30"
                                cy="30"
                                r={RADIUS}
                                fill="none"
                                stroke="rgba(255,255,255,0.12)"
                                stroke-width="3"
                            />
                            <circle
                                class="ring-countdown"
                                cx="30"
                                cy="30"
                                r={RADIUS}
                                fill="none"
                                stroke="url(#ring-gradient)"
                                stroke-width="3"
                                stroke-linecap="round"
                                stroke-dasharray={CIRCUMFERENCE}
                                stroke-dashoffset={CIRCUMFERENCE * (1 - left / total)}
                            />
                            <defs>
                                <linearGradient id="ring-gradient" x1="0" y1="0" x2="1" y2="0">
                                    <stop offset="0" stop-color="#8629fc" />
                                    <stop offset="1" stop-color="#4156f6" />
                                </linearGradient>
                            </defs>
                        </svg>
                        <FriendAvatar size="face" />
                    </span>
                    <div class="flex min-w-0 flex-col">
                        <h2 id="ring-card-title" class="m-0 truncate text-base font-bold normal-case tracking-normal">
                            {$LL.chat.friends.ring.card.wantsToTalk({ userName: card.fromName })}
                        </h2>
                        {#if place}
                            <span id="ring-card-place" class="flex min-w-0 items-center gap-1 text-xs text-white/70">
                                <IconMapPin font-size="13" class="shrink-0" />
                                <span class="truncate">{place}</span>
                            </span>
                        {/if}
                        <span class="sr-only" aria-live="polite">
                            {seconds % 10 === 0 ? $LL.chat.friends.ring.card.secondsLeft({ seconds }) : ""}
                        </span>
                    </div>
                    <IconBellRinging font-size="20" class="ring-bell ms-auto shrink-0 self-start text-[#c4b5fd]" />
                </div>
                <div class="flex items-center gap-2">
                    <button
                        type="button"
                        class="u-cta m-0 flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-4 text-sm font-bold text-white disabled:opacity-60"
                        aria-label={$LL.chat.friends.ring.card.comeOverTo({ userName: card.fromName })}
                        disabled={answering}
                        data-testid="ringComeOver"
                        on:click={comeOver}
                    >
                        <IconSend font-size="18" />
                        {$LL.chat.friends.ring.card.comeOver()}
                    </button>
                    <button
                        type="button"
                        class="u-cta-secondary m-0 flex h-11 min-w-0 flex-1 items-center justify-center rounded-full px-4 text-sm font-bold text-white"
                        data-testid="ringNotNow"
                        on:click={notNow}
                    >
                        {$LL.chat.friends.ring.card.notNow()}
                    </button>
                </div>
                {#if !here}
                    <p class="m-0 px-1 text-xs text-white/55">
                        {$LL.chat.friends.ring.card.note({ userName: card.fromName })}
                    </p>
                {/if}
            </section>
        {/key}
    {/if}
    {#each $ringToastsStore as toast (toast.id)}
        <div
            class="ring-toast pointer-events-auto flex max-w-[400px] items-center gap-2 rounded-full py-2 pe-4 ps-3 text-sm font-semibold text-white"
            role="status"
            data-testid="ringToast"
            transition:fly={{ y: -16, duration: 200 }}
        >
            {#if toast.kind === "arrived" || toast.kind === "accepted"}
                <IconCheck font-size="16" class="shrink-0 text-[#4ADE80]" />
            {:else}
                <IconInfoCircle font-size="16" class="shrink-0 text-[#c4b5fd]" />
            {/if}
            <span class="min-w-0 truncate">{toastText(toast)}</span>
        </div>
    {/each}
</div>

<style>
    .ring-card,
    .ring-toast {
        background: linear-gradient(160deg, rgb(31 28 47 / 0.96), rgb(20 18 30 / 0.97));
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1px rgba(167, 139, 250, 0.22),
            0 18px 48px -12px rgba(0, 0, 0, 0.6), 0 0 32px -12px rgba(134, 41, 252, 0.55);
        backdrop-filter: blur(18px) saturate(140%);
        -webkit-backdrop-filter: blur(18px) saturate(140%);
    }
    .ring-countdown {
        transition: stroke-dashoffset 1s linear;
    }
    :global(.ring-bell) {
        animation: ring-bell 1.6s ease-in-out infinite;
        transform-origin: 50% 10%;
    }
    @keyframes ring-bell {
        0%,
        60%,
        100% {
            transform: rotate(0);
        }
        10% {
            transform: rotate(14deg);
        }
        20% {
            transform: rotate(-12deg);
        }
        30% {
            transform: rotate(8deg);
        }
        40% {
            transform: rotate(-4deg);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        :global(.ring-bell) {
            animation: none;
        }
        .ring-countdown {
            transition: none;
        }
    }
</style>
