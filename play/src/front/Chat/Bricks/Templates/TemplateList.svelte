<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { fly } from "svelte/transition";
    import { closeModal, openModal } from "svelte-modals";
    import LL from "../../../../i18n/i18n-svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import BrickPicture from "../BrickPicture.svelte";
    import { keepFocusInside } from "../keepFocusInside";
    import type { TemplateCard, TemplateLists } from "./Template";
    import TemplateSheet from "./TemplateSheet.svelte";
    import { readTemplateLists } from "./Templates";
    import { IconChevronRight, IconStarFilled, IconX } from "@wa-icons";
    import "../BrickGroups.css";
    import "./Templates.css";

    /**
     * "Start from a template" (game #2008, mock Part 20 picture 5): three short lists. The ones the person starred, a few
     * picked by Universe, and Bricks they have met that share one. Only what they may open is listed; a row opens the
     * template's look, where Create Brick is. Popular and Trending are not here: they arrive with the Community shelf.
     */
    export let isOpen: boolean;

    type Phase = "loading" | "ready" | "failed";

    let phase: Phase = "loading";
    let lists: TemplateLists = { starred: [], picks: [], met: [] };
    let dismissed = false;
    onDestroy(() => (dismissed = true));

    $: t = $LL.chat.brick.templates;
    $: sections = [
        { key: "starred", title: t.starredList(), cards: lists.starred },
        { key: "picks", title: t.picks(), cards: lists.picks },
        { key: "met", title: t.met(), cards: lists.met },
    ].filter((section) => section.cards.length > 0);

    async function load() {
        phase = "loading";
        const read = await readTemplateLists();
        if (dismissed) return;
        if (!read.ok) {
            phase = "failed";
            return;
        }
        lists = read.value;
        phase = "ready";
    }

    onMount(() => {
        load().catch((error) => console.error(error));
    });

    function about(card: TemplateCard): string {
        const by = card.mine ? t.byYou() : card.makerName ? t.by({ maker: card.makerName }) : "";
        const line = card.description?.trim().replace(/\s+/g, " ") ?? "";
        return by && line ? t.byLine({ by, about: line }) : by || line;
    }

    function open(card: TemplateCard) {
        openModal(TemplateSheet, { templateId: card.id });
    }
</script>

{#if isOpen}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="tp-scrim" on:click|self={closeModal}>
        <div
            class="tp-sheet u-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-list-title"
            data-testid="templateList"
            use:keepFocusInside={closeModal}
            transition:fly={{ y: 16, duration: 200 }}
        >
            <button
                type="button"
                class="u-close absolute top-2 end-2"
                aria-label={$LL.chat.brick.closeCard()}
                data-testid="templateListClose"
                on:click={closeModal}
            >
                <IconX font-size="20" />
            </button>
            <h2 id="template-list-title" class="u-display tp-title">{t.listTitle()}</h2>
            <p class="tp-sub">{t.listSub()}</p>
            {#if phase === "loading"}
                <p class="tp-sub" data-testid="templateListLoading">{$LL.chat.brick.loading()}</p>
            {:else if phase === "failed"}
                <p class="tp-bad" data-testid="templateListFailed">{t.listFailed()}</p>
                <div class="tp-btns">
                    <PageButton tall testId="templateListRetry" on:click={load}>{$LL.chat.brick.tryAgain()}</PageButton>
                </div>
            {:else if sections.length === 0}
                <p class="tp-sub" data-testid="templateListNone">{t.listNone()}</p>
            {:else}
                {#each sections as section (section.key)}
                    <div class="bkg-cap gap" data-testid="templateListSection">{section.title}</div>
                    {#each section.cards as card (card.id)}
                        <button type="button" class="bkg-tap" data-testid="templateRow" on:click={() => open(card)}>
                            <span class="tp-row-woka"><BrickPicture look={card.look} size={44} /></span>
                            <span class="bkg-mtx">
                                <span class="bkg-t">{card.name}</span>
                                {#if about(card)}<span class="bkg-cn">{about(card)}</span>{/if}
                            </span>
                            {#if card.starred}
                                <span class="tp-star" aria-label={t.starred()}><IconStarFilled font-size="16" /></span>
                            {/if}
                            <IconChevronRight class="bkg-go" font-size="18" />
                        </button>
                    {/each}
                {/each}
                <p class="tp-note">{t.listNote()}</p>
            {/if}
        </div>
    </div>
{/if}
