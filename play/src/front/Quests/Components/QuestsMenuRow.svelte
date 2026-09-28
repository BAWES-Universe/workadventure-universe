<script lang="ts">
    import { LL } from "../../../i18n/i18n-svelte";
    import ActionBarButton from "../../Components/ActionBar/ActionBarButton.svelte";
    import AchievementIcon from "../../Components/Icons/AchievementIcon.svelte";
    import { openedMenuStore } from "../../Stores/MenuStore";
    import { openQuestLog, profileMenuTrigger } from "../QuestDockFocus";
    import { questAcceptedCountStore, questNewsStore, questStateStore } from "../QuestStore";

    // Enter or Space opened it: focus goes into the log. A tap or a click leaves focus (and walking) alone.
    let fromKeyboard = false;
    function trackInput(node: HTMLElement) {
        const onKeydown = (event: KeyboardEvent) => {
            if (event.key === "Enter" || event.key === " ") fromKeyboard = true;
        };
        const onPointerdown = () => (fromKeyboard = false);
        node.addEventListener("keydown", onKeydown);
        node.addEventListener("pointerdown", onPointerdown);
        return {
            destroy() {
                node.removeEventListener("keydown", onKeydown);
                node.removeEventListener("pointerdown", onPointerdown);
            },
        };
    }

    function open() {
        openedMenuStore.close("profileMenu");
        openQuestLog(profileMenuTrigger(), fromKeyboard);
        fromKeyboard = false;
    }

    $: count = $questStateStore.tracked ? 0 : $questAcceptedCountStore;
</script>

<ActionBarButton label={$LL.quest.quests()} dataTestId="quests-menu-row" action={trackInput} on:click={open}>
    <AchievementIcon hover="" />
    <span slot="end" class="ms-2 inline-flex items-center">
        {#if $questNewsStore}
            <span class="quest-news-dot" data-testid="quests-news-dot" />
            <span class="sr-only">{$LL.quest.newActivity()}</span>
        {:else if count > 0}
            <span class="u-count" aria-hidden="true">{count}</span>
            <span class="sr-only">{$LL.quest.acceptedCount({ count })}</span>
        {/if}
    </span>
</ActionBarButton>

<style>
    .quest-news-dot {
        display: block;
        width: 0.75rem;
        height: 0.75rem;
        border-radius: 999px;
        background: #c4b5fd;
        border: 1.5px solid #1b2a41;
    }
</style>
