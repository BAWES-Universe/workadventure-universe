<script lang="ts">
    import type { Action } from "svelte/action";
    import { fly } from "svelte/transition";
    import { closeModal } from "svelte-modals";
    import LL from "../../../i18n/i18n-svelte";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { connectionManager } from "../../Connection/ConnectionManager";
    import { brickPictureUrl, DEFAULT_BRICK_LOOK } from "./Brick";
    import { IconHeart, IconPlugConnected, IconRobot, IconSparkles, IconX } from "@wa-icons";

    /**
     * The card that asks a guest to sign in to keep the Brick (#1997, mock v10, Part 1). The same card as the one a guest
     * gets for a message to anyone (RequiresLoginForChatModal): the Brick in place of the chat icon, a plain title, and what
     * signing in adds. Signing in brings the chat along.
     */
    export let isOpen: boolean;

    const signIn = () => {
        analyticsClient.login();
        connectionManager.goToSignIn();
    };

    // A dialog keeps the keyboard inside it: focus moves to the sign-in button when it opens, Tab goes round its
    // buttons, and whatever had focus before gets it back when it closes.
    const keepFocusInside: Action<HTMLElement> = (node) => {
        const before = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        const buttons = () => Array.from(node.querySelectorAll<HTMLElement>("button:not([disabled])"));
        node.querySelector<HTMLElement>("[data-testid='guestBrickSignInGo']")?.focus();

        function onKeydown(event: KeyboardEvent) {
            if (event.key !== "Tab") return;
            const all = buttons();
            const first = all[0];
            const last = all[all.length - 1];
            if (!first || !last) return;
            if (!node.contains(document.activeElement)) {
                event.preventDefault();
                first.focus();
            } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
        document.addEventListener("keydown", onKeydown);

        return {
            destroy() {
                document.removeEventListener("keydown", onKeydown);
                before?.focus();
            },
        };
    };

    $: rows = [
        { icon: IconHeart, text: $LL.chat.brick.guest.signInRemembers() },
        { icon: IconSparkles, text: $LL.chat.brick.guest.signInMakes() },
        { icon: IconPlugConnected, text: $LL.chat.brick.guest.signInApps() },
        { icon: IconRobot, text: $LL.chat.brick.guest.signInMore() },
    ];
</script>

{#if isOpen}
    <div class="pointer-events-none fixed inset-0 z-[2001] flex items-center justify-center px-3">
        <div
            class="guest-login u-surface pointer-events-auto relative w-full sm:w-[400px] rounded-2xl text-start text-white"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guest-brick-title"
            data-testid="guestBrickSignIn"
            use:keepFocusInside
            transition:fly={{ y: 16, duration: 200 }}
        >
            <button
                type="button"
                class="u-close absolute top-2 end-2"
                aria-label={$LL.chat.brick.guest.close()}
                data-testid="closeModal"
                on:click={closeModal}
            >
                <IconX font-size="20" />
            </button>

            <div class="flex items-start gap-3.5 ps-4 pe-14 pt-4 pb-3">
                <img class="brick" src={brickPictureUrl(DEFAULT_BRICK_LOOK)} alt="" />
                <div class="min-w-0">
                    <h2 id="guest-brick-title" class="u-display m-0 text-xl leading-7">
                        {$LL.chat.brick.guest.signInTitle()}
                    </h2>
                    <p class="guest-login-muted m-0 mt-1 text-sm leading-5">{$LL.chat.brick.guest.signInBody()}</p>
                </div>
            </div>

            <ul class="m-0 flex list-none flex-col gap-2.5 px-4 pb-4 pt-0 text-[13px] leading-5 text-white/80">
                {#each rows as row (row.text)}
                    <li class="flex items-start gap-3">
                        <span class="guest-tile" aria-hidden="true"
                            ><svelte:component this={row.icon} font-size="18" /></span
                        >
                        <span>{row.text}</span>
                    </li>
                {/each}
            </ul>

            <div class="flex gap-2 px-4 pb-4 mobile:flex-col-reverse">
                <button
                    type="button"
                    class="u-cta-secondary m-0 flex h-11 flex-1 mobile:flex-none items-center justify-center rounded-full px-4 text-sm font-bold"
                    data-testid="guestBrickSignInNotNow"
                    on:click={closeModal}>{$LL.chat.brick.guest.notNow()}</button
                >
                <button
                    type="button"
                    class="u-cta m-0 flex h-11 flex-1 mobile:flex-none items-center justify-center rounded-full px-4 text-sm font-bold"
                    data-testid="guestBrickSignInGo"
                    on:click={signIn}>{$LL.chat.brick.guest.signIn()}</button
                >
            </div>
        </div>
    </div>
{/if}

<style>
    .guest-login {
        font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .guest-login button {
        font-family: inherit;
    }
    .guest-login-muted {
        color: rgba(255, 255, 255, 0.7);
    }
    .brick {
        flex: none;
        width: 44px;
        height: 44px;
        object-fit: contain;
        image-rendering: pixelated;
    }
    .guest-tile {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.25rem;
        height: 1.25rem;
        flex-shrink: 0;
        color: #fff;
    }
</style>
