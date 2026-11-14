<script lang="ts">
    import { onDestroy } from "svelte";
    import { fly } from "svelte/transition";
    import { closeModal } from "svelte-modals";
    import LL from "../../../../i18n/i18n-svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import BrickPicture from "../BrickPicture.svelte";
    import { keepFocusInside } from "../keepFocusInside";
    import type { MadeFromView, TemplateChange, TemplateUpdate, UpdateField } from "./Template";
    import { readMadeFrom, takeTemplateUpdate } from "./Templates";
    import { IconCheck, IconX } from "@wa-icons";
    import "../BrickGroups.css";
    import "./Templates.css";

    /**
     * "Template updated" (game #2008): the maker shared a newer version of the template this Brick was made from. It is
     * offered as a change to review, never applied by itself: for each part, what the Brick has and what the template says
     * now, and the owner takes the parts they pick, or none. Taking none closes the offer for that version. Routines it
     * adds arrive switched off.
     */
    export let isOpen: boolean;
    export let brickId: string;
    export let name: string;
    export let makerName: string;
    export let update: TemplateUpdate;
    /** Called with the Brick's page data once the owner has chosen, or when the offer turned out to be gone. */
    export let onDone: (view: MadeFromView | undefined) => void;

    let taken = new Set<UpdateField>();
    let busy = false;
    let changedAgain = false;
    let gone = false;
    onDestroy(() => (gone = true));

    $: t = $LL.chat.brick.templates;

    function toggle(field: UpdateField) {
        const next = new Set(taken);
        if (next.has(field)) next.delete(field);
        else next.add(field);
        taken = next;
    }

    function title(change: TemplateChange): string {
        switch (change.field) {
            case "description":
                return t.changeLine();
            case "look":
                return t.itsLook();
            case "instructions":
                return t.instructions();
            case "firstThing":
                return t.firstThing();
            case "routines":
                return t.changeRoutines({ count: change.routines.length });
        }
    }

    async function choose(take: UpdateField[]) {
        if (busy) return;
        busy = true;
        changedAgain = false;
        const answer = await takeTemplateUpdate(brickId, update.version, take);
        // eslint-disable-next-line require-atomic-updates
        busy = false;
        if (gone) return;
        if (answer.done) {
            if (answer.routinesLeftOut > 0) {
                warningMessageStore.addWarningMessage(t.routinesLeftOut({ count: answer.routinesLeftOut }));
            }
            onDone(answer.view);
            closeModal();
            return;
        }
        if (answer.why === "changed") {
            // The template changed again, or the offer is gone: what is offered now is read again
            const read = await readMadeFrom(brickId);
            if (gone) return;
            if (read.ok && read.value.update) {
                // eslint-disable-next-line require-atomic-updates
                update = read.value.update;
                taken = new Set();
                changedAgain = true;
                onDone(read.value);
            } else {
                onDone(read.ok ? read.value : undefined);
                closeModal();
            }
            return;
        }
        warningMessageStore.addWarningMessage(t.updateFailed());
    }
</script>

{#if isOpen}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="tp-scrim" on:click|self={closeModal}>
        <div
            class="tp-sheet u-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-update-title"
            data-testid="templateUpdate"
            use:keepFocusInside={closeModal}
            transition:fly={{ y: 16, duration: 200 }}
        >
            <button
                type="button"
                class="u-close absolute top-2 end-2"
                aria-label={$LL.chat.brick.closeCard()}
                data-testid="templateUpdateClose"
                on:click={closeModal}
            >
                <IconX font-size="20" />
            </button>
            <h2 id="template-update-title" class="u-display tp-title">{t.updatedTitle()}</h2>
            <p class="tp-sub">{makerName ? t.updatedSub({ maker: makerName, name }) : t.updatedSubNoMaker({ name })}</p>
            {#if changedAgain}
                <p class="tp-bad" role="alert" data-testid="templateUpdateAgain">{t.updatedAgain()}</p>
            {/if}
            {#each update.changes as change (change.field)}
                {@const on = taken.has(change.field)}
                <button
                    type="button"
                    class="bkg-tap tp-pick"
                    aria-pressed={on}
                    data-testid="templateUpdateChange"
                    on:click={() => toggle(change.field)}
                >
                    <span class="tp-tick" class:on aria-hidden="true"
                        >{#if on}<IconCheck font-size="16" />{/if}</span
                    >
                    <span class="bkg-mtx">
                        <span class="bkg-t">{title(change)}</span>
                        {#if change.field === "look"}
                            <span class="tp-looks">
                                <span class="bkg-cn">{t.nowLabel()}</span>
                                <BrickPicture look={change.mine} size={32} />
                                <span class="bkg-cn">{t.templateLabel()}</span>
                                <BrickPicture look={change.theirs} size={32} />
                            </span>
                        {:else if change.field === "routines"}
                            {#each change.routines as routine, i (i)}
                                <span class="bkg-cn">{routine.words}</span>
                            {/each}
                            <span class="bkg-cn">{t.routineGoesOff()}</span>
                        {:else}
                            {#if change.mine}
                                <span class="bkg-cn">{t.nowLabel()}: {change.mine}</span>
                            {/if}
                            <span class="bkg-cn tp-theirs">{t.templateLabel()}: {change.theirs}</span>
                        {/if}
                    </span>
                </button>
            {/each}
            <p class="tp-note">{t.updatedNote({ name })}</p>
            <div class="tp-btns">
                <PageButton tall disabled={busy} testId="templateKeepMine" on:click={() => choose([])}
                    >{t.keepMine()}</PageButton
                >
                <PageButton
                    tall
                    go
                    disabled={busy || taken.size === 0}
                    testId="templateTake"
                    on:click={() => choose([...taken])}>{t.take({ count: taken.size })}</PageButton
                >
            </div>
        </div>
    </div>
{/if}

<style>
    .tp-pick {
        align-items: flex-start;
    }
    .tp-tick {
        display: grid;
        place-items: center;
        flex: none;
        width: 24px;
        height: 24px;
        margin-top: 2px;
        border-radius: 50%;
        box-shadow: inset 0 0 0 2px rgba(244, 242, 250, 0.4);
        color: #fff;
    }
    .tp-tick.on {
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: none;
    }
    .tp-looks {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .tp-theirs {
        color: rgba(244, 242, 250, 0.86);
    }
    .bkg-cn {
        overflow-wrap: anywhere;
        white-space: pre-wrap;
        max-height: 9em;
        overflow-y: auto;
    }
</style>
