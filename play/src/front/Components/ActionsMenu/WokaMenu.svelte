<script lang="ts">
    import type { Unsubscriber } from "svelte/store";
    import { onDestroy } from "svelte";
    import { wokaMenuStore, wokaMenuProgressStore } from "../../Stores/WokaMenuStore";
    import ButtonClose from "../Input/ButtonClose.svelte";
    import VisitCard from "../VisitCard/VisitCard.svelte";
    import WokaFromUserId from "../Woka/WokaFromUserId.svelte";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import LL from "../../../i18n/i18n-svelte";
    import { peopleCardReturn } from "../../Chat/Stores/PeopleCardReturnStore";
    import type { WokaMenuAction, WokaMenuData } from "../../Stores/WokaMenuStore";
    import { IconDots } from "@wa-icons";

    let wokaMenuData: WokaMenuData | undefined;
    let sortedActions: WokaMenuAction[] | undefined;
    let mainActions: WokaMenuAction[] = [];
    let overflowActions: WokaMenuAction[] = [];
    /** The "more" (⋯) list is open. It closes whenever the card turns to someone else. */
    let moreOpen = false;
    let moreOpenFor: string | undefined;

    let wokaMenuStoreUnsubscriber: Unsubscriber | null;

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape" && wokaMenuData) {
            dismiss();
        }
    }

    function closeActionsMenu() {
        wokaMenuStore.clear();
    }

    // Closed without doing anything: on a phone, back to the People tab if the card was opened from it.
    function dismiss() {
        peopleCardReturn.dismissCard();
    }

    function displayName(name: string): string {
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    let buttonsLayout: "row" | "column" | "wrap" = "row";

    wokaMenuStoreUnsubscriber = wokaMenuStore.subscribe((value) => {
        wokaMenuData = value;
        if (wokaMenuData) {
            sortedActions = [...wokaMenuData.actions.values()].sort((a, b) => {
                const ap = a.priority ?? 0;
                const bp = b.priority ?? 0;
                if (ap > bp) {
                    return -1;
                }
                if (ap < bp) {
                    return 1;
                } else {
                    return 0;
                }
            });
            mainActions = sortedActions.filter((action) => !action.overflow);
            overflowActions = sortedActions.filter((action) => action.overflow);
            const cardFor = `${wokaMenuData.userUuid}#${wokaMenuData.userId}#${wokaMenuData.isSelf ? "me" : ""}`;
            if (cardFor !== moreOpenFor) {
                moreOpen = false;
                moreOpenFor = cardFor;
            }
            const nbButtons =
                mainActions.length + (overflowActions.length > 0 ? 1 : 0) + (wokaMenuData.wokaName ? 0 : 1);
            if (nbButtons < 4) {
                buttonsLayout = "row";
            } else {
                buttonsLayout = "wrap";
            }
        }
    });

    onDestroy(() => {
        if (wokaMenuStoreUnsubscriber) {
            wokaMenuStoreUnsubscriber();
        }
    });
</script>

<svelte:window on:keydown={onKeyDown} />

{#if wokaMenuData}
    <div
        class="m-auto my-0 h-fit min-h-fit max-w-lg min-w-48 max-sm:max-w-[89%] z-50 bg-contrast/80 transition-all backdrop-blur rounded-lg pointer-events-auto overflow-hidden md:mr-0"
        data-testid="actions-menu"
    >
        <div>
            <div class="w-full bg-cover relative">
                <div class="absolute top-2 right-2">
                    <ButtonClose on:click={dismiss} />
                </div>

                <div class="flex items-center justify-center p-2">
                    <div class="text-white flex flex-col justify-center items-center font-bold text-xl">
                        {#if wokaMenuData.isSelf || (wokaMenuData.userId != undefined && wokaMenuData.userId != -1)}
                            <div
                                id="woka"
                                class=" bt-3 overflow-hidden mt-9 border w-fit h-fit pt-3 rounded-lg cursor-not-allowed bg-[rgb(103,185,133)]"
                            >
                                <WokaFromUserId
                                    userId={wokaMenuData.isSelf ? -1 : wokaMenuData.userId}
                                    placeholderSrc="/assets/placeholder-woka.png"
                                    customWidth="4rem"
                                />
                            </div>
                        {/if}
                        <div class=" w-max mt-[29px]">
                            <!-- The name as its owner saved it, first letter capitalised; never all capitals. -->
                            <h3 class="normal-case">{displayName(wokaMenuData.wokaName)}</h3>
                        </div>
                    </div>
                </div>

                {#if wokaMenuData.visitCardUrl}
                    <VisitCard
                        visitCardUrl={wokaMenuData.visitCardUrl}
                        isEmbedded={true}
                        showSendMessageButton={false}
                    />
                {/if}

                {#if $wokaMenuProgressStore}
                    <div class="px-4 pb-4 pt-2">
                        <div class="w-full bg-white/10 rounded-full h-2 mb-2">
                            <div
                                class="bg-primary h-2 rounded-full transition-all duration-300"
                                style="width: {$wokaMenuProgressStore.progress}%"
                            />
                        </div>
                        <p class="text-white/80 text-sm text-center animate-pulse">
                            {$wokaMenuProgressStore.message}
                        </p>
                    </div>
                {/if}
            </div>
        </div>

        {#if sortedActions}
            <div
                class="flex items-center bg-contrast w-full justify-center"
                class:margin-close={!wokaMenuData.wokaName}
                class:flex-row={buttonsLayout === "row"}
                class:flex-wrap={buttonsLayout === "wrap"}
            >
                {#each mainActions as action (action.uuid)}
                    <button
                        type="button"
                        data-testid={action.testId}
                        class="btn btn-light btn-ghost text-nowrap justify-center my-2 mx-1 min-w-0 {action.style ??
                            ''}"
                        class:mx-2={buttonsLayout === "column"}
                        on:click={() => analyticsClient.clickPropertyMapEditor(action.actionName, action.style)}
                        on:click|preventDefault={() => {
                            closeActionsMenu();
                            action.callback();
                        }}
                    >
                        <span class="flex flex-row gap-1 items-center justify-center">
                            {#if action.actionIcon && typeof action.actionIcon === "string"}
                                <div class="w-6 h-6">
                                    <img src={action.actionIcon} class="w-full h-full" alt="" />
                                </div>
                            {:else if action.actionIcon && typeof action.actionIcon === "function"}
                                <svelte:component this={action.actionIcon} class="w-6 h-6" />
                            {/if}
                            {action.actionName}
                        </span>
                    </button>
                {/each}

                {#if overflowActions.length > 0}
                    <button
                        type="button"
                        data-testid="wokamenu-more-button"
                        class="btn btn-light btn-ghost justify-center my-2 mx-1 min-w-0 bg-white/10 hover:bg-white/30 aspect-square px-2"
                        aria-label={$LL.chat.userList.moreActions({ userName: displayName(wokaMenuData.wokaName) })}
                        title={$LL.chat.userList.moreActions({ userName: displayName(wokaMenuData.wokaName) })}
                        aria-expanded={moreOpen}
                        on:click|preventDefault={() => (moreOpen = !moreOpen)}
                    >
                        <IconDots class="w-6 h-6" />
                    </button>
                {/if}

                {#if !wokaMenuData.wokaName}
                    <button
                        type="button"
                        class="btn btn-light btn-ghost text-nowrap justify-center my-2 mx-1 w-fit"
                        on:click|preventDefault|stopPropagation={closeActionsMenu}
                    >
                        {$LL.actionbar.close()}
                    </button>
                {/if}
            </div>
            {#if moreOpen && overflowActions.length > 0}
                <!-- Inside the card (which clips what overflows it), on the same solid panel as the buttons. -->
                <div class="flex flex-col bg-contrast border-t border-white/10 p-1" role="menu">
                    {#each overflowActions as action (action.uuid)}
                        <button
                            type="button"
                            role="menuitem"
                            data-testid={action.testId}
                            class="flex gap-2 items-center w-full min-h-10 px-3 rounded text-sm text-start text-white hover:bg-white/10 {action.style ??
                                ''}"
                            on:click={() => analyticsClient.clickPropertyMapEditor(action.actionName, action.style)}
                            on:click|preventDefault={() => {
                                closeActionsMenu();
                                action.callback();
                            }}
                        >
                            {#if action.actionIcon && typeof action.actionIcon === "string"}
                                <img src={action.actionIcon} class="w-5 h-5" alt="" />
                            {:else if action.actionIcon && typeof action.actionIcon === "function"}
                                <svelte:component this={action.actionIcon} class="w-5 h-5" />
                            {/if}
                            {action.actionName}
                        </button>
                    {/each}
                </div>
            {/if}
        {/if}
    </div>
{/if}

<style lang="scss">
</style>
