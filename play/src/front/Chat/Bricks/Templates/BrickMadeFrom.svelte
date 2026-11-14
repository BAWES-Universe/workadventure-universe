<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { openModal } from "svelte-modals";
    import LL from "../../../../i18n/i18n-svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import { joinNames, missingNeeds, type MadeFromView, type UpdateField } from "./Template";
    import TemplateUpdateSheet from "./TemplateUpdateSheet.svelte";
    import { readMadeFrom } from "./Templates";
    import { IconPlugConnectedX, IconSparkles, IconTemplate } from "@wa-icons";
    import "../BrickGroups.css";
    import "./Templates.css";

    /**
     * On a Brick made from a template (game #2008, mock Part 20 picture 3): "Setup required" until its main job can work,
     * who made the template it started from, routines that came switched off, and "Template updated" as a change to
     * review. Nothing here shows on any other Brick. It never pretends to be ready: the page opens on what is missing.
     */
    export let brickId: string;
    export let name: string;
    /** Opens a group of the Brick's page (the Computer one, for a Brick that needs a computer). */
    export let onOpenGroup: (id: string) => void;
    /** Opens the Apps page looking for this app: "Connect Gmail". */
    export let onConnect: (label: string) => void;
    /** Called with the parts the owner took from an update, so the page can show them (its Personality, its line, its look). */
    export let onTaken: (taken: UpdateField[]) => void = () => undefined;
    /** When this changes, the page is read again (a computer was given, a group moved): the setup it shows is never old. */
    export let refreshKey: unknown = undefined;

    let view: MadeFromView | undefined;
    let gone = false;
    onDestroy(() => (gone = true));

    $: t = $LL.chat.brick.templates;
    $: missing = view ? missingNeeds(view.setup.needs) : [];
    $: maker = view?.madeFrom.makerName ?? "";

    // Counts reads: an older answer that comes back after a newer one is not shown
    let reads = 0;
    function load() {
        const mine = ++reads;
        readMadeFrom(brickId)
            .then((read) => {
                // Not made from a template, or Orbit did not say: nothing shows, and the page is as it was
                // eslint-disable-next-line svelte/infinite-reactive-loop
                if (!gone && mine === reads && read.ok) view = read.value;
            })
            .catch((error) => console.error(error));
    }

    onMount(load);

    let seenKey = refreshKey;
    $: if (refreshKey !== seenKey) {
        seenKey = refreshKey;
        // Only a Brick that is made from a template has anything to read again. Once per change of the key, so no loop.
        // eslint-disable-next-line svelte/infinite-reactive-loop
        if (view) load();
    }

    function review() {
        const update = view?.update;
        if (!update) return;
        openModal(TemplateUpdateSheet, {
            brickId,
            name,
            makerName: maker,
            update,
            onDone: (next: MadeFromView | undefined, taken: UpdateField[] = []) => {
                if (gone) return;
                view = next ?? view;
                if (taken.length > 0) onTaken(taken);
            },
        });
    }
</script>

{#if view}
    <div class="mf" class:warn={missing.length > 0} data-testid="brickMadeFrom">
        {#if missing.length > 0}
            <div class="bkg-tap" data-testid="brickSetupRequired">
                <span class="bkg-ico tp-warn"><IconPlugConnectedX font-size="20" /></span>
                <span class="bkg-mtx">
                    <span class="bkg-t">{t.setupRequired()}</span>
                    <span class="bkg-cn"
                        >{t.setupLine({
                            name,
                            needs: joinNames(
                                missing.map((need) => (need.kind === "computer" ? t.aComputer() : need.label)),
                                t.and()
                            ),
                        })}</span
                    >
                </span>
            </div>
            <div class="mf-acts">
                {#each missing as need (need.key)}
                    {#if need.kind === "computer"}
                        <PageButton tall go testId="brickSetupComputer" on:click={() => onOpenGroup("computer")}
                            >{t.giveComputer()}</PageButton
                        >
                    {:else}
                        <PageButton tall go testId="brickSetupConnect" on:click={() => onConnect(need.label)}
                            >{t.connect({ label: need.label })}</PageButton
                        >
                    {/if}
                {/each}
            </div>
            <div class="mf-hr" />
        {/if}
        <div class="bkg-tap" data-testid="brickMadeFromLine">
            <span class="bkg-ico"><IconTemplate font-size="20" /></span>
            <span class="bkg-mtx">
                <span class="bkg-t"
                    >{maker
                        ? t.madeFrom({ template: view.madeFrom.templateName, maker })
                        : t.madeFromNoMaker({ template: view.madeFrom.templateName })}</span
                >
                <span class="bkg-cn"
                    >{view.madeFrom.shared
                        ? t.madeFromHint({ maker: maker || t.theMaker(), name })
                        : t.madeFromStopped({ maker: maker || t.theMaker(), name })}</span
                >
            </span>
        </div>
        {#if view.setup.routinesOff > 0}
            <div class="bkg-tap" data-testid="brickRoutinesOff">
                <span class="bkg-ico"><IconSparkles font-size="20" /></span>
                <span class="bkg-mtx">
                    <span class="bkg-t">{t.routinesCame({ count: view.setup.routinesOff })}</span>
                    <span class="bkg-cn">{t.routinesCameHint()}</span>
                </span>
            </div>
        {/if}
        {#if view.update}
            <div class="bkg-tap" data-testid="brickTemplateUpdated">
                <span class="bkg-ico"><IconSparkles font-size="20" /></span>
                <span class="bkg-mtx">
                    <span class="bkg-t">{t.updatedRow()}</span>
                    <span class="bkg-cn">{t.updatedRowHint({ count: view.update.changes.length })}</span>
                </span>
                <PageButton testId="brickTemplateReview" on:click={review}>{t.review()}</PageButton>
            </div>
        {/if}
    </div>
{/if}

<style>
    .mf {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 8px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
    }
    .mf.warn {
        box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.35);
    }
    .mf-acts {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        margin: 0 0 6px 44px;
    }
    .mf-hr {
        height: 1px;
        margin: 4px 0;
        background: rgba(255, 255, 255, 0.1);
    }
</style>
