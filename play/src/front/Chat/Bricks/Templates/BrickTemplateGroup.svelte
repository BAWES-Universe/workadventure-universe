<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { openModal } from "svelte-modals";
    import LL from "../../../../i18n/i18n-svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import PageGroup from "../../../external-modules/bots/components/page/PageGroup.svelte";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import { NO_CHOICES, type MakerChoices, type MakerTemplate, type TemplateLook } from "./Template";
    import TemplateLookSheet from "./TemplateLookSheet.svelte";
    import { readMakerTemplate, readTemplateLook, stopSharingTemplate } from "./Templates";
    import { IconCheck, IconChevronRight, IconLock, IconPlugConnected, IconSparkles, IconTemplate } from "@wa-icons";
    import "../BrickGroups.css";

    /**
     * Template on a Brick's page (game #2008, mock Part 20 pictures 6 and 7): share this Brick so other people can make
     * their own from it. Not shared, it says what goes with it, what people will need and what never goes, and Share as a
     * template opens the look first: exactly what would be shared, read from the Brick. Shared, it says how many Bricks were
     * made from it, offers "Share your latest changes" when the Brick changed, and "Stop sharing", which deletes nobody's
     * Brick. No switch.
     */
    export let brickId: string;
    export let name: string;
    export let open = false;
    export let onToggle: (id: string) => void;

    type Phase = "loading" | "ready" | "failed";

    let phase: Phase = "loading";
    let template: MakerTemplate | undefined;
    let look: TemplateLook | undefined;
    // The look is being read, was read, or could not be: "needs nothing" is only said after a read that found nothing
    let lookState: "reading" | "read" | "failed" = "reading";
    let choices: MakerChoices = NO_CHOICES;
    let editingFirst = false;
    let firstDraft = "";
    let stopping = false;
    // Counts reads of the look: one that comes back after a newer choice was made is not shown
    let reading = 0;
    let gone = false;
    onDestroy(() => (gone = true));

    $: t = $LL.chat.brick.templates;
    $: shared = !!template?.shared;
    $: brief =
        phase !== "ready" || !template
            ? ""
            : shared
            ? template.madeFrom > 0
                ? t.briefShared({ count: template.madeFrom })
                : t.briefSharedNone()
            : t.briefNotShared();
    $: firstThing = look?.firstThing ?? null;

    async function load() {
        phase = "loading";
        const read = await readMakerTemplate(brickId);
        if (gone) return;
        if (!read.ok) {
            phase = "failed";
            return;
        }
        template = read.value;
        choices = read.value.choices;
        phase = "ready";
        await readLook();
    }

    async function readLook() {
        const mine = ++reading;
        lookState = "reading";
        const answer = await readTemplateLook(brickId, choices, template?.audience);
        if (gone || mine !== reading) return;
        // Not readable (the look comes back when the group opens again): the rows that need it say nothing
        look = answer.ok ? answer.value : undefined;
        lookState = answer.ok ? "read" : "failed";
    }

    // The group opens: what the maker changed on the page since (so "Share your latest changes" shows) is read again.
    // Only the template's own state is taken; what was chosen here stays.
    let wasOpen = open;
    let refreshing = 0;
    $: if (open !== wasOpen) {
        wasOpen = open;
        if (open && phase === "ready") refresh().catch((error) => console.error(error));
    }

    async function refresh() {
        const mine = ++refreshing;
        const read = await readMakerTemplate(brickId);
        if (gone || mine !== refreshing || !read.ok) return;
        template = read.value;
        await readLook();
    }

    onMount(() => {
        load().catch((error) => console.error(error));
    });

    function choose(next: MakerChoices) {
        choices = next;
        readLook().catch((error) => console.error(error));
    }

    function toggleLook() {
        choose({ ...choices, leaveOutLook: !choices.leaveOutLook });
    }

    function toggleNeed(key: string) {
        const optional = choices.optionalNeeds.includes(key)
            ? choices.optionalNeeds.filter((one) => one !== key)
            : [...choices.optionalNeeds, key];
        choose({ ...choices, optionalNeeds: optional });
    }

    function toggleRoutine(id: string) {
        const routines = choices.routines.includes(id)
            ? choices.routines.filter((one) => one !== id)
            : [...choices.routines, id];
        choose({ ...choices, routines });
    }

    function changeFirst() {
        firstDraft = firstThing ?? "";
        editingFirst = true;
    }

    function saveFirst() {
        editingFirst = false;
        choose({ ...choices, firstThing: firstDraft.trim() });
    }

    function openLook() {
        openModal(TemplateLookSheet, {
            brickId,
            choices,
            audience: template?.audience ?? null,
            shared,
            onShared: (next: MakerTemplate) => {
                template = next;
                choices = next.choices;
                readLook().catch((error) => console.error(error));
            },
        });
    }

    async function stop() {
        if (stopping) return;
        stopping = true;
        const next = await stopSharingTemplate(brickId);
        // eslint-disable-next-line require-atomic-updates
        stopping = false;
        if (gone) return;
        if (!next) {
            warningMessageStore.addWarningMessage(t.stopFailed());
            return;
        }
        template = next;
        choices = next.choices;
        readLook().catch((error) => console.error(error));
    }
</script>

<PageGroup id="template" icon={IconTemplate} title={t.title()} {brief} {open} {onToggle}>
    <div class="bkg" data-testid="brickTemplate">
        {#if phase === "failed"}
            <div class="bkg-retry">
                <p class="bkg-lead">{t.groupFailed({ name })}</p>
                <PageButton testId="templateGroupRetry" on:click={load}>{$LL.chat.brick.tryAgain()}</PageButton>
            </div>
        {:else if phase === "ready" && template && shared}
            <div class="tp-model" data-testid="templateShared">
                <span class="bkg-cap tp-flush">{t.sharedAs()}</span>
                <span class="tp-mid">{t.madeFromCount({ count: template.madeFrom })}</span>
                <span class="bkg-cn">{t.sharedVersion({ version: template.version ?? 1, name })}</span>
            </div>
            {#if template.hasChanges}
                <div class="bkg-acts">
                    <PageButton tall testId="templateShareLatest" on:click={openLook}>{t.shareLatest()}</PageButton>
                </div>
            {:else}
                <p class="bkg-note" data-testid="templateUpToDate">{t.upToDate({ version: template.version ?? 1 })}</p>
            {/if}
            <p class="bkg-note">
                <IconSparkles font-size="14" /><span>{t.updatesNote()}</span>
            </p>
            <div class="bkg-off">
                <PageButton tall danger disabled={stopping} testId="templateStop" on:click={stop}
                    >{t.stopSharing()}</PageButton
                >
                <span class="bkg-cn">{t.stopHint()}</span>
            </div>
        {:else if phase === "ready" && template}
            <p class="bkg-lead">{t.lead()}</p>
            <div class="bkg-cap">{t.goesWith()}</div>
            <div class="bkg-tap" data-testid="templateRowLook">
                <span class="bkg-ico"><IconCheck font-size="20" /></span>
                <span class="bkg-mtx">
                    <span class="bkg-t">{t.itsLook()}</span>
                    <span class="bkg-cn">{choices.leaveOutLook ? t.lookLeftOut() : t.lookGoes()}</span>
                </span>
                <PageButton testId="templateLeaveOutLook" on:click={toggleLook}
                    >{choices.leaveOutLook ? t.putBack() : t.leaveOut()}</PageButton
                >
            </div>
            <button type="button" class="bkg-tap" data-testid="templateReadLook" on:click={openLook}>
                <span class="bkg-ico"><IconCheck font-size="20" /></span>
                <span class="bkg-mtx">
                    <span class="bkg-t">{t.personality()}</span>
                    <span class="bkg-cn">{t.readExactly()}</span>
                </span>
                <IconChevronRight class="bkg-go" font-size="18" />
            </button>
            {#if editingFirst}
                <div class="bkg-tap" data-testid="templateFirstEdit">
                    <span class="bkg-ico"><IconCheck font-size="20" /></span>
                    <span class="bkg-mtx">
                        <label class="bkg-t" for="template-first-{brickId}">{t.firstThing()}</label>
                        <textarea
                            id="template-first-{brickId}"
                            class="bkg-field"
                            rows="2"
                            maxlength="300"
                            bind:value={firstDraft}
                            data-testid="templateFirstField"
                        />
                        <span class="bkg-acts">
                            <PageButton testId="templateFirstSave" on:click={saveFirst}>{t.save()}</PageButton>
                            <PageButton testId="templateFirstCancel" on:click={() => (editingFirst = false)}
                                >{$LL.mapEditor.edit.bots.page.create.cancel()}</PageButton
                            >
                        </span>
                    </span>
                </div>
            {:else}
                <div class="bkg-tap" data-testid="templateRowFirst">
                    <span class="bkg-ico"><IconCheck font-size="20" /></span>
                    <span class="bkg-mtx">
                        <span class="bkg-t">{t.firstThing()}</span>
                        <span class="bkg-cn">{firstThing ? `“${firstThing}”` : t.firstThingNone()}</span>
                    </span>
                    <PageButton testId="templateChangeFirst" on:click={changeFirst}>{t.change()}</PageButton>
                </div>
            {/if}
            {#if template.routineChoices.length > 0}
                <div class="bkg-cap gap">{t.routinesTitle()}</div>
                {#each template.routineChoices as routine (routine.id)}
                    {@const along = choices.routines.includes(routine.id)}
                    <div class="bkg-tap" data-testid="templateRowRoutine">
                        <span class="bkg-ico"><IconCheck font-size="20" /></span>
                        <span class="bkg-mtx">
                            <span class="bkg-t">{routine.words}</span>
                            <span class="bkg-cn">{along ? t.routineAlong() : t.routineStays()}</span>
                        </span>
                        <PageButton testId="templateToggleRoutine" on:click={() => toggleRoutine(routine.id)}
                            >{along ? t.leaveOut() : t.takeAlong()}</PageButton
                        >
                    </div>
                {/each}
            {/if}
            <div class="bkg-cap gap">{t.theyNeed()}</div>
            {#if look && look.needs.length > 0}
                {#each look.needs as need (need.key)}
                    <div class="bkg-tap" data-testid="templateRowNeed">
                        <span class="bkg-ico"><IconPlugConnected font-size="20" /></span>
                        <span class="bkg-mtx">
                            <span class="bkg-t"
                                >{need.kind === "computer"
                                    ? t.aComputer()
                                    : t.appOfTheirOwn({ label: need.label })}</span
                            >
                            <span class="bkg-cn">{need.required ? t.needHint() : t.needOptional()}</span>
                        </span>
                        <PageButton testId="templateToggleNeed" on:click={() => toggleNeed(need.key)}
                            >{need.required ? t.notNeeded() : t.needed()}</PageButton
                        >
                    </div>
                {/each}
            {:else if lookState === "reading"}
                <p class="bkg-note" data-testid="templateNeedsLoading">{$LL.chat.brick.loading()}</p>
            {:else if lookState === "failed"}
                <p class="bkg-note" data-testid="templateNeedsFailed">{t.lookFailed()}</p>
                <PageButton testId="templateNeedsRetry" on:click={() => readLook()}
                    >{$LL.chat.brick.tryAgain()}</PageButton
                >
            {:else}
                <div class="bkg-tap" data-testid="templateNoNeeds">
                    <span class="bkg-ico"><IconPlugConnected font-size="20" /></span>
                    <span class="bkg-mtx">
                        <span class="bkg-t">{t.needsNothing()}</span>
                        <span class="bkg-cn">{t.needsNothingHint()}</span>
                    </span>
                </div>
            {/if}
            <div class="bkg-cap gap">{t.neverGoes()}</div>
            <div class="bkg-tap">
                <span class="bkg-ico"><IconLock font-size="20" /></span>
                <span class="bkg-mtx">
                    <span class="bkg-t">{t.neverMemory()}</span>
                    <span class="bkg-cn">{t.neverMemoryHint()}</span>
                </span>
            </div>
            <div class="bkg-tap">
                <span class="bkg-ico"><IconLock font-size="20" /></span>
                <span class="bkg-mtx">
                    <span class="bkg-t">{t.neverApps()}</span>
                    <span class="bkg-cn">{t.neverAppsHint()}</span>
                </span>
            </div>
            <button type="button" class="bkg-go-btn" data-testid="templateShare" on:click={openLook}>
                {t.share()}
            </button>
            <p class="bkg-note">
                <IconSparkles font-size="14" /><span>{t.shareNote({ name })}</span>
            </p>
        {:else}
            <p class="bkg-lead" data-testid="templateGroupLoading">{$LL.chat.brick.loading()}</p>
        {/if}
    </div>
</PageGroup>

<style>
    .tp-model {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(0, 0, 0, 0.3);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .tp-flush {
        padding: 0;
    }
    .tp-mid {
        font-size: 17px;
        font-weight: 700;
    }
</style>
