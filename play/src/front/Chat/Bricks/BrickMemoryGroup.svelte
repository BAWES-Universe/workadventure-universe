<script lang="ts">
    import { onMount } from "svelte";
    import LL from "../../../i18n/i18n-svelte";
    import PageButton from "../../external-modules/bots/components/page/PageButton.svelte";
    import PageGroup from "../../external-modules/bots/components/page/PageGroup.svelte";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import { botMemoryList, type MemoryItem } from "./BotMemory";
    import MemoryRows from "./MemoryRows.svelte";
    import { IconBrain, IconChevronRight, IconSparkles } from "@wa-icons";
    import "./BrickGroups.css";

    /**
     * Memory on a Brick's page (game #2003): what this Brick remembers about its owner, four things first, each with
     * Forget, then "See all". "Forget everything" starts fresh with the person; their chats and files stay. Only this
     * person's own list: Orbit shows it to nobody else.
     */
    export let botId: string;
    export let name: string;
    export let open = false;
    export let onToggle: (id: string) => void;

    /** The first rows the group shows before "See all". */
    const FIRST = 4;

    const list = botMemoryList(botId);
    const { items, state } = list;
    let all = false;
    let asking = false;
    let busy = false;

    $: shown = all ? $items : $items.slice(0, FIRST);
    $: brief =
        $state === "ready"
            ? $items.length > 0
                ? $LL.chat.brick.memory.brief({ count: $items.length })
                : $LL.chat.brick.memory.briefNone()
            : "";

    onMount(() => {
        list.load().catch((error) => console.error(error));
    });

    function forget(item: MemoryItem) {
        list.forget(item.id)
            .then((gone) => {
                if (!gone) warningMessageStore.addWarningMessage($LL.chat.brick.memory.forgotFailed());
            })
            .catch((error) => console.error(error));
    }

    function forgetEverything() {
        if (busy) return;
        busy = true;
        list.forgetEverything()
            .then((gone) => {
                if (gone) asking = false;
                else warningMessageStore.addWarningMessage($LL.chat.brick.memory.forgotFailed());
            })
            .catch((error) => console.error(error))
            .finally(() => {
                busy = false;
            });
    }
</script>

<PageGroup id="memory" icon={IconBrain} title={$LL.chat.brick.memory.title()} {brief} {open} {onToggle}>
    <div class="bkg" data-testid="brickMemory">
        {#if $state === "failed"}
            <div class="bkg-retry">
                <p class="bkg-lead">{$LL.chat.brick.memory.loadFailed({ name })}</p>
                <PageButton testId="memoryRetry" on:click={() => list.load()}
                    >{$LL.chat.brick.memory.retry()}</PageButton
                >
            </div>
        {:else if $state === "ready" && $items.length === 0}
            <p class="bkg-lead" data-testid="memoryEmpty">{$LL.chat.brick.memory.leadNone({ name })}</p>
        {:else if $state === "ready"}
            <p class="bkg-lead">{$LL.chat.brick.memory.lead({ name })}</p>
            <MemoryRows items={shown} onForget={forget} />
            {#if !all && $items.length > FIRST}
                <button type="button" class="bkg-tap" data-testid="memorySeeAll" on:click={() => (all = true)}>
                    <span class="bkg-mtx"
                        ><span class="bkg-t">{$LL.chat.brick.memory.seeAll({ count: $items.length })}</span></span
                    >
                    <IconChevronRight class="bkg-go" font-size="18" />
                </button>
            {/if}
            <p class="bkg-note">
                <IconSparkles font-size="14" /><span>{$LL.chat.brick.memory.note()}</span>
            </p>
            {#if $items.length > 0}
                <div class="bkg-off">
                    {#if asking}
                        <p class="bkg-note" role="alert" data-testid="memoryAsk">
                            <span>{$LL.chat.brick.memory.startsFresh({ name })}</span>
                        </p>
                        <div class="bkg-row">
                            <PageButton tall disabled={busy} testId="memoryKeep" on:click={() => (asking = false)}
                                >{$LL.mapEditor.edit.bots.page.about.keep()}</PageButton
                            >
                            <PageButton
                                tall
                                danger
                                disabled={busy}
                                testId="memoryForgetEverythingConfirm"
                                on:click={forgetEverything}>{$LL.chat.brick.memory.forgetEverything()}</PageButton
                            >
                        </div>
                    {:else}
                        <PageButton tall danger testId="memoryForgetEverything" on:click={() => (asking = true)}
                            >{$LL.chat.brick.memory.forgetEverything()}</PageButton
                        >
                        <span class="bkg-cn">{$LL.chat.brick.memory.startsFresh({ name })}</span>
                    {/if}
                </div>
            {/if}
        {/if}
    </div>
</PageGroup>

<style>
    .bkg-row {
        display: flex;
        gap: 8px;
    }
</style>
