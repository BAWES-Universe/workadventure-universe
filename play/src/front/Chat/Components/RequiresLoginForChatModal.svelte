<script lang="ts">
    import type { Action } from "svelte/action";
    import { fly } from "svelte/transition";
    import { closeModal } from "svelte-modals";
    import LL from "../../../i18n/i18n-svelte";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { connectionManager } from "../../Connection/ConnectionManager";
    import { IconMessage, IconX } from "@wa-icons";

    export let isOpen: boolean;

    const goToLoginPage = () => {
        analyticsClient.login();
        connectionManager.goToSignIn();
    };

    // A dialog keeps the keyboard inside it: focus moves to the sign-in button when it opens, Tab goes round its
    // buttons, and whatever had focus before gets it back when it closes.
    const keepFocusInside: Action<HTMLElement> = (node) => {
        const before = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        const buttons = () => Array.from(node.querySelectorAll<HTMLElement>("button:not([disabled])"));
        node.querySelector<HTMLElement>("[data-testid='requiresLoginForChatSignIn']")?.focus();

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
</script>

{#if isOpen}
    <!-- The same card as the new-device popup: raised ink surface, plain white glyph, close in the corner. -->
    <div class="pointer-events-none fixed inset-0 z-[2001] flex items-center justify-center px-3">
        <div
            class="guest-login u-surface pointer-events-auto relative w-full sm:w-[400px] rounded-2xl text-start text-white"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guest-login-title"
            data-testid="requiresLoginForChatModal"
            use:keepFocusInside
            transition:fly={{ y: 16, duration: 200 }}
        >
            <button
                type="button"
                class="u-close absolute top-2 end-2"
                aria-label={$LL.chat.requiresLoginForChatModal.close()}
                data-testid="closeModal"
                on:click={closeModal}
            >
                <IconX font-size="20" />
            </button>

            <div class="flex items-start gap-3.5 ps-4 pe-14 pt-4 pb-4">
                <span class="guest-login-icon" aria-hidden="true"><IconMessage font-size="28" /></span>
                <div class="min-w-0">
                    <h2 id="guest-login-title" class="u-display m-0 text-xl leading-7">
                        {$LL.chat.requiresLoginForChatModal.titleStart()}<span class="u-text-brand"
                            >{$LL.chat.requiresLoginForChatModal.titleHighlight()}</span
                        >
                    </h2>
                    <p class="guest-login-muted m-0 mt-1 text-sm leading-5">
                        {$LL.chat.requiresLoginForChatModal.body()}
                    </p>
                </div>
            </div>

            <div class="flex gap-2 px-4 pb-4 mobile:flex-col-reverse">
                <button
                    type="button"
                    class="u-cta-secondary m-0 flex h-11 flex-1 mobile:flex-none items-center justify-center rounded-full px-4 text-sm font-bold"
                    on:click={closeModal}>{$LL.chat.requiresLoginForChatModal.notNow()}</button
                >
                <button
                    type="button"
                    class="u-cta m-0 flex h-11 flex-1 mobile:flex-none items-center justify-center rounded-full px-4 text-sm font-bold"
                    data-testid="requiresLoginForChatSignIn"
                    on:click={goToLoginPage}>{$LL.chat.requiresLoginForChatModal.signIn()}</button
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
    .guest-login-icon {
        flex: none;
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        color: #fff;
    }
    .guest-login-muted {
        color: rgba(255, 255, 255, 0.7);
    }
</style>
