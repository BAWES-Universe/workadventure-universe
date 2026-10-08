<script lang="ts">
    import { getContext } from "svelte";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import FollowIcon from "../../Icons/FollowIcon.svelte";
    import ActionBarButton from "../ActionBarButton.svelte";
    import { askToFollow, endFollow, followRoleStore, followStateStore } from "../../../Stores/FollowStore";
    import { bubbleMatesStore } from "../../../Stores/CurrentPlayerGroupStore";
    import LL from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { openedMenuStore } from "../../../Stores/MenuStore";

    const inMenu = getContext("inMenu");

    function followClick() {
        if ($followStateStore === "off") {
            askToFollow();
        } else {
            endFollow();
        }
        // In the menu: close it, so the card (or the map) is in view.
        if (inMenu) {
            openedMenuStore.close("profileMenu");
        }
    }

    function nameOf(userId: number): string {
        return gameManager.getCurrentGameScene().MapPlayersByKey.get(userId)?.playerName ?? "";
    }

    $: on = $followStateStore !== "off";
    $: title = !on
        ? $LL.actionbar.help.follow.title()
        : $followRoleStore === "follower"
        ? $LL.actionbar.help.unfollow.title()
        : $followStateStore === "requesting"
        ? $LL.follow.menu.cancel()
        : $LL.follow.menu.stopLeading();
    // Under "Ask to follow" in the menu: who will be asked.
    $: subtitle =
        on || $bubbleMatesStore.length === 0
            ? undefined
            : $bubbleMatesStore.length === 1
            ? $LL.follow.ask.one({ name: nameOf($bubbleMatesStore[0]) })
            : $LL.follow.ask.many({ count: $bubbleMatesStore.length });
</script>

<ActionBarButton
    on:click={() => {
        analyticsClient.follow();
        followClick();
    }}
    classList="group/btn-follow"
    wideLabel={title}
    tooltipTitle={title}
    disabledHelp={$openedMenuStore !== undefined}
    state={on ? "active" : "normal"}
    media="./static/Videos/Follow.mp4"
    desc={on ? $LL.actionbar.help.unfollow.desc() : $LL.actionbar.help.follow.desc()}
    dataTestId="follow-menu-item"
>
    <FollowIcon />
    <svelte:fragment slot="end">
        {#if inMenu && subtitle}
            <span
                class="block whitespace-normal text-xs font-normal leading-4 text-white/60"
                data-testid="follow-menu-subtitle">{subtitle}</span
            >
        {/if}
    </svelte:fragment>
</ActionBarButton>
