<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { fly } from "svelte/transition";
    import { closeModal } from "svelte-modals";
    import LL from "../../../../i18n/i18n-svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import BrickPicture from "../BrickPicture.svelte";
    import { keepFocusInside } from "../keepFocusInside";
    import type { MakerChoices, MakerTemplate, TemplateFinding, TemplateLook } from "./Template";
    import { readTemplateLook, shareTemplateLook } from "./Templates";
    import { IconAlertTriangle, IconCheck, IconLock, IconPlugConnected, IconX } from "@wa-icons";
    import "../BrickGroups.css";
    import "./Templates.css";

    /**
     * The look before sharing (game #2008): exactly what would go with the template (its name, look, instructions, first
     * thing to try, what people will need and the routines the maker added), and what never goes. It is read from the Brick
     * when the sheet opens, and what is shared is exactly this: if the Brick changed after it was read, nothing is shared
     * and the look is read again. Something that looks like a secret holds sharing back until it is taken out.
     */
    export let isOpen: boolean;
    export let brickId: string;
    export let choices: MakerChoices;
    /** What the template is shared with already, so a new share keeps it. */
    export let audience: string | null = null;
    /** Shared already: the button says "Share your latest changes". */
    export let shared = false;
    /** Called with the template group once it is shared. */
    export let onShared: (template: MakerTemplate) => void;

    type Phase = "loading" | "ready" | "failed" | "gone";

    let phase: Phase = "loading";
    let look: TemplateLook | undefined;
    let busy = false;
    let changedNote = false;
    let secretNote = false;
    let dismissed = false;
    onDestroy(() => (dismissed = true));

    $: t = $LL.chat.brick.templates;
    $: secrets = look?.findings.filter((finding) => finding.kind === "secret") ?? [];
    $: details = look?.findings.filter((finding) => finding.kind === "detail") ?? [];

    async function load() {
        phase = "loading";
        const read = await readTemplateLook(brickId, choices, audience);
        if (dismissed) return;
        if (!read.ok) {
            phase = read.why;
            return;
        }
        look = read.value;
        phase = "ready";
    }

    onMount(() => {
        load().catch((error) => console.error(error));
    });

    function whereIn(finding: TemplateFinding): string {
        const routine = /^routine (\d+)$/.exec(finding.where);
        if (routine) return t.whereRoutine({ number: Number(routine[1]) });
        if (finding.where === "description") return t.whereLine();
        if (finding.where === "instructions") return t.whereInstructions();
        if (finding.where === "firstThing") return t.whereFirst();
        return finding.where;
    }

    async function share() {
        if (!look || look.blocked || busy) return;
        busy = true;
        changedNote = false;
        secretNote = false;
        const done = await shareTemplateLook(brickId, look, choices, audience);
        // eslint-disable-next-line require-atomic-updates
        busy = false;
        if (dismissed) return;
        if (done.done) {
            onShared(done.template);
            closeModal();
            return;
        }
        if (done.why === "changed") {
            // The Brick changed since this was read: nothing was shared, and what is read now is what would go
            changedNote = true;
            await load();
        } else if (done.why === "secret") {
            secretNote = true;
            await load();
        } else if (done.why === "gone") {
            phase = "gone";
        } else {
            warningMessageStore.addWarningMessage(t.shareFailed());
        }
    }
</script>

{#if isOpen}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="tp-scrim" on:click|self={closeModal}>
        <div
            class="tp-sheet u-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-look-title"
            data-testid="templateLook"
            use:keepFocusInside={closeModal}
            transition:fly={{ y: 16, duration: 200 }}
        >
            <button
                type="button"
                class="u-close absolute top-2 end-2"
                aria-label={$LL.chat.brick.closeCard()}
                data-testid="templateLookClose"
                on:click={closeModal}
            >
                <IconX font-size="20" />
            </button>
            <h2 id="template-look-title" class="u-display tp-title">{t.lookTitle()}</h2>
            {#if phase === "ready" && look}
                <p class="tp-sub">{t.lookSub()}</p>
                {#if changedNote}
                    <p class="tp-bad" role="alert" data-testid="templateLookChanged">{t.lookChanged()}</p>
                {/if}
                {#if secrets.length > 0}
                    <div class="bkg-cap gap">{t.takeOut()}</div>
                    {#each secrets as finding, i (i)}
                        <div class="bkg-tap" data-testid="templateSecret">
                            <span class="bkg-ico tp-warn"><IconAlertTriangle font-size="20" /></span>
                            <span class="bkg-mtx">
                                <span class="bkg-t">{t.found({ what: finding.what })}</span>
                                <span class="bkg-cn"
                                    >{t.foundIn({ where: whereIn(finding) })}{finding.sample
                                        ? ` · ${finding.sample}`
                                        : ""}</span
                                >
                            </span>
                        </div>
                    {/each}
                    <p class="tp-note">{secretNote ? t.secretStill() : t.secretHint()}</p>
                {/if}
                {#if details.length > 0}
                    <div class="bkg-cap gap">{t.checkThese()}</div>
                    {#each details as finding, i (i)}
                        <div class="bkg-tap" data-testid="templateDetail">
                            <span class="bkg-ico"><IconAlertTriangle font-size="20" /></span>
                            <span class="bkg-mtx">
                                <span class="bkg-t">{t.found({ what: finding.what })}</span>
                                <span class="bkg-cn"
                                    >{t.foundIn({ where: whereIn(finding) })}{finding.sample
                                        ? ` · ${finding.sample}`
                                        : ""}</span
                                >
                            </span>
                        </div>
                    {/each}
                {/if}

                <div class="bkg-cap gap">{t.goesWith()}</div>
                <div class="bkg-tap" data-testid="templateLookName">
                    <span class="bkg-ico">
                        {#if look.look}<BrickPicture look={look.look} size={32} />{:else}<IconCheck
                                font-size="20"
                            />{/if}
                    </span>
                    <span class="bkg-mtx">
                        <span class="bkg-t">{look.name}</span>
                        <span class="bkg-cn">{look.look ? t.itsLook() : t.lookLeftOut()}</span>
                    </span>
                </div>
                {#if look.description}
                    <div class="bkg-tap">
                        <span class="bkg-ico"><IconCheck font-size="20" /></span>
                        <span class="bkg-mtx">
                            <span class="bkg-t">{look.description}</span>
                            <span class="bkg-cn">{t.itsLine()}</span>
                        </span>
                    </div>
                {/if}
                <div class="bkg-tap">
                    <span class="bkg-ico"><IconCheck font-size="20" /></span>
                    <span class="bkg-mtx">
                        <span class="bkg-t">{t.instructionsShared()}</span>
                        <span class="bkg-cn"
                            >{look.instructions ? t.instructionsReadBelow() : t.instructionsNone()}</span
                        >
                    </span>
                </div>
                {#if look.instructions}
                    <p class="tp-read" data-testid="templateLookInstructions">{look.instructions}</p>
                {/if}
                <div class="bkg-tap">
                    <span class="bkg-ico"><IconCheck font-size="20" /></span>
                    <span class="bkg-mtx">
                        <span class="bkg-t">{t.firstThing()}</span>
                        <span class="bkg-cn">{look.firstThing ? `“${look.firstThing}”` : t.firstThingNone()}</span>
                    </span>
                </div>
                {#each look.routines as routine, i (i)}
                    <div class="bkg-tap" data-testid="templateLookRoutine">
                        <span class="bkg-ico"><IconCheck font-size="20" /></span>
                        <span class="bkg-mtx">
                            <span class="bkg-t">{routine.words}</span>
                            <span class="bkg-cn">{t.routineGoesOff()}</span>
                        </span>
                    </div>
                {/each}

                {#if look.needs.length > 0}
                    <div class="bkg-cap gap">{t.theyNeed()}</div>
                    {#each look.needs as need (need.key)}
                        <div class="bkg-tap">
                            <span class="bkg-ico"><IconPlugConnected font-size="20" /></span>
                            <span class="bkg-mtx">
                                <span class="bkg-t">{need.kind === "computer" ? t.aComputer() : need.label}</span>
                                <span class="bkg-cn">{need.required ? t.needRequired() : t.needOptional()}</span>
                            </span>
                        </div>
                    {/each}
                {/if}

                <div class="bkg-cap gap">{t.neverGoes()}</div>
                <div class="bkg-tap tp-off">
                    <span class="bkg-ico"><IconLock font-size="20" /></span>
                    <span class="bkg-mtx">
                        <span class="bkg-t">{t.neverMemory()}</span>
                        <span class="bkg-cn">{t.neverMemoryHint()}</span>
                    </span>
                </div>
                <div class="bkg-tap tp-off">
                    <span class="bkg-ico"><IconLock font-size="20" /></span>
                    <span class="bkg-mtx">
                        <span class="bkg-t">{t.neverApps()}</span>
                        <span class="bkg-cn">{t.neverAppsHint()}</span>
                    </span>
                </div>

                <div class="tp-btns">
                    <PageButton tall testId="templateLookCancel" on:click={closeModal}
                        >{$LL.mapEditor.edit.bots.page.create.cancel()}</PageButton
                    >
                    <PageButton tall go disabled={look.blocked || busy} testId="templateLookShare" on:click={share}
                        >{shared ? t.shareLatest() : t.share()}</PageButton
                    >
                </div>
            {:else if phase === "loading"}
                <p class="tp-sub" data-testid="templateLookLoading">{$LL.chat.brick.loading()}</p>
            {:else if phase === "gone"}
                <p class="tp-bad" data-testid="templateLookGone">{t.brickGone()}</p>
                <div class="tp-btns">
                    <PageButton tall go on:click={closeModal}>{t.close()}</PageButton>
                </div>
            {:else}
                <p class="tp-bad" data-testid="templateLookFailed">{t.lookFailed()}</p>
                <div class="tp-btns">
                    <PageButton tall testId="templateLookRetry" on:click={load}>{$LL.chat.brick.tryAgain()}</PageButton>
                </div>
            {/if}
        </div>
    </div>
{/if}
