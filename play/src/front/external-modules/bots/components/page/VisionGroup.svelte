<script lang="ts">
    // Vision: where the images people send go. The bot's own model still writes every reply; this says what looks at the
    // images when its own model can't (or when the owner would rather something else did). Shown picked: what really happens.
    import LL from "../../../../../i18n/i18n-svelte";
    import type { BotAiOptions, BotData } from "../../types";
    import { botApiService } from "../../services/BotApiService";
    import { canPickVision, visionState, withVisionChoice, type VisionCandidate } from "../../visionModel";
    import PageGroup from "./PageGroup.svelte";
    import { IconEye, IconEyeOff, IconInfoCircle, IconKey, IconSparkles, IconChevronDown } from "@wa-icons";

    export let bot: BotData;
    export let open: boolean;
    export let onToggle: (id: string) => void;
    export let onChange: (bot: BotData) => void;

    /** What Orbit says about this bot's AI (the same answer the Mind group uses). Null when it can't say: the row stays out. */
    let options: BotAiOptions | null = null;
    let loadedFor: string | undefined | null = null;
    let loadCount = 0;

    async function load(botId: string | undefined) {
        // Only the newest load may answer: a slow reply for the bot the panel was on before must not show on this one
        const mine = ++loadCount;
        if (!botApiService.isInitialized()) return;
        try {
            const loaded = await botApiService.getBotAiOptions(botId ? { botId } : {});
            if (mine === loadCount) options = loaded;
        } catch (e) {
            console.error("[VisionGroup] Failed to load AI options:", e);
        }
    }

    function showFor(botId: string | undefined) {
        if (loadedFor === botId) return;
        loadedFor = botId;
        options = null;
        void load(botId);
    }

    // On first show, and again whenever the panel moves to another bot (it stays mounted when the bot changes)
    $: showFor(bot.id);

    $: page = $LL.mapEditor.edit.bots.page;
    $: ref = bot.aiProviderRef ?? "";
    $: state = options ? visionState(options, ref || null, bot) : null;
    $: effective = state?.effective;
    $: botName = bot.name ?? "";

    $: brief = !state
        ? ""
        : state.problem
        ? page.vision.briefProblem()
        : state.effective.choice === "another"
        ? page.vision.briefAnother({ model: state.effective.model })
        : state.effective.choice === "universe-ai"
        ? page.vision.briefUniverseAi()
        : state.main.sees
        ? page.vision.briefThisSees({ model: state.main.model ?? state.main.name })
        : page.vision.briefThisBlind();

    function choose(choice: "this" | "universe-ai" | "another") {
        if (!options || !state) return;
        // Tapping what is shown as the default keeps it as the owner's own pick; tapping what they picked does nothing
        if (state.picked && state.effective.choice === choice && !state.problem) return;
        if (!canPickVision(options, state, choice)) return;
        onChange(withVisionChoice(bot, state, choice));
    }

    function chooseModel(event: Event) {
        if (!options || !state) return;
        const value = (event.currentTarget as HTMLSelectElement).value;
        const candidate = state.candidates.find((entry) => `${entry.keyId}|${entry.model}` === value);
        if (candidate) onChange(withVisionChoice(bot, state, "another", candidate));
    }

    const valueOf = (candidate: VisionCandidate) => `${candidate.keyId}|${candidate.model}`;
    const mainModel = (model: string | null, fallback: string) => model ?? fallback;
</script>

{#if options && state && effective}
    <PageGroup id="vision" icon={IconEye} title={page.vision.title()} {brief} {open} {onToggle}>
        {#if state.problem}
            <p class="bp-m bp-warn" role="alert" data-testid="bot-vision-problem">{page.vision.problem()}</p>
        {/if}
        {#if !state.main.sees}
            <p class="bp-m">
                {page.vision.intro({ model: mainModel(state.main.model, state.main.name), bot: botName })}
            </p>
        {/if}
        <div class="bp-cap" id="bot-vision-label">{page.vision.imagesGoTo()}</div>
        <div class="bp-cards" role="radiogroup" aria-labelledby="bot-vision-label" data-testid="bot-vision">
            <button
                type="button"
                role="radio"
                class="bp-card"
                class:picked={effective.choice === "this"}
                aria-checked={effective.choice === "this"}
                data-testid="bot-vision-this"
                on:click={() => choose("this")}
            >
                <span class="bp-cico">
                    {#if state.main.sees}<IconEye font-size="20" />{:else}<IconEyeOff font-size="20" />{/if}
                </span>
                <span class="bp-ctx">
                    <span class="bp-ct">{page.vision.thisModel()}</span>
                    <span class="bp-cn">
                        {#if state.main.sees}
                            {page.vision.thisSees({ model: mainModel(state.main.model, state.main.name) })}
                        {:else}
                            {page.vision.thisBlind({
                                model: mainModel(state.main.model, state.main.name),
                                bot: botName,
                            })}
                            {#if state.main.group === "own-computer"}{page.vision.thisBlindComputer()}{/if}
                        {/if}
                    </span>
                    {#if state.main.sees}
                        <span class="bp-chips">
                            <span class="bp-chip-name">{mainModel(state.main.model, state.main.name)}</span>
                            <span class="bp-chip"
                                ><IconEye font-size="14" />{$LL.mapEditor.edit.bots.page.mind.seesPictures()}</span
                            >
                        </span>
                    {/if}
                </span>
                <span class="bp-radio" class:on={effective.choice === "this"} aria-hidden="true" />
            </button>

            <button
                type="button"
                role="radio"
                class="bp-card"
                class:picked={effective.choice === "another"}
                aria-checked={effective.choice === "another"}
                disabled={effective.choice !== "another" && !canPickVision(options, state, "another")}
                data-testid="bot-vision-another"
                on:click={() => choose("another")}
            >
                <span class="bp-cico"><IconKey font-size="20" /></span>
                <span class="bp-ctx">
                    <span class="bp-ct">{page.vision.anotherModel()}</span>
                    <span class="bp-cn">
                        {#if effective.choice === "another"}
                            {effective.sameKey
                                ? page.vision.anotherSameKey({ key: effective.keyName })
                                : page.vision.anotherOtherKey({ key: effective.keyName })}
                        {:else if state.candidates.length > 0}
                            {page.vision.anotherUse()}
                        {:else if options.viewerIsMaker}
                            {page.vision.anotherNone()}
                        {:else}
                            {page.vision.anotherMaker({ bot: botName })}
                        {/if}
                    </span>
                    {#if effective.choice === "another"}
                        <span class="bp-chips">
                            <span class="bp-chip-name">{effective.model}</span>
                            <span class="bp-chip"
                                ><IconEye font-size="14" />{$LL.mapEditor.edit.bots.page.mind.seesPictures()}</span
                            >
                        </span>
                    {/if}
                </span>
                <span class="bp-radio" class:on={effective.choice === "another"} aria-hidden="true" />
            </button>

            <button
                type="button"
                role="radio"
                class="bp-card"
                class:picked={effective.choice === "universe-ai"}
                aria-checked={effective.choice === "universe-ai"}
                disabled={effective.choice !== "universe-ai" && !canPickVision(options, state, "universe-ai")}
                data-testid="bot-vision-universe-ai"
                on:click={() => choose("universe-ai")}
            >
                <span class="bp-cico"><IconSparkles font-size="20" /></span>
                <span class="bp-ctx">
                    <span class="bp-ct">{$LL.mapEditor.edit.bots.page.mind.universeAi()}</span>
                    <span class="bp-cn">
                        {options.universeAi.available
                            ? $LL.mapEditor.edit.bots.page.mind.universeAiNote()
                            : $LL.mapEditor.edit.bots.page.mind.universeAiMissing()}
                    </span>
                    {#if state.main.keyId}
                        <span class="bp-info" data-testid="bot-vision-leaves">
                            <IconInfoCircle font-size="16" />
                            <span>
                                {#if effective.choice !== "universe-ai"}
                                    {page.vision.universeAiWouldLeave({ key: state.main.name })}
                                {:else if state.main.group === "own-computer"}
                                    {page.vision.universeAiLeavesComputer({ key: state.main.name })}
                                {:else}
                                    {page.vision.universeAiLeaves({ key: state.main.name })}
                                {/if}
                            </span>
                        </span>
                    {/if}
                </span>
                <span class="bp-radio" class:on={effective.choice === "universe-ai"} aria-hidden="true" />
            </button>
        </div>
        {#if effective.choice === "another" && state.candidates.length > 1}
            <label class="bp-select">
                <span class="sr-only">{page.vision.anotherPick()}</span>
                <select
                    value={`${effective.keyId}|${effective.model}`}
                    on:change={chooseModel}
                    data-testid="bot-vision-model"
                >
                    {#each state.candidates as candidate (valueOf(candidate))}
                        <option value={valueOf(candidate)}>
                            {page.vision.anotherOption({ model: candidate.model, key: candidate.keyName })}
                        </option>
                    {/each}
                </select>
                <IconChevronDown font-size="16" />
            </label>
        {/if}
    </PageGroup>
{/if}

<style>
    .bp-cap {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-cards {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .bp-card {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 56px;
        margin: 0;
        padding: 12px;
        border: 0;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
        font: inherit;
        color: #fff;
        text-align: left;
        cursor: pointer;
    }
    .bp-card.picked {
        background: rgba(134, 41, 252, 0.16);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.7);
    }
    .bp-card:disabled:not(.picked) {
        opacity: 0.55;
        cursor: default;
    }
    .bp-card:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .bp-cico {
        flex: none;
        display: inline-flex;
        color: #fff;
    }
    .bp-ctx {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .bp-ct {
        font-size: 15px;
        font-weight: 700;
        overflow-wrap: anywhere;
    }
    .bp-cn {
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-chips {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 12px;
        font-size: 12.5px;
    }
    .bp-chip-name {
        color: #fff;
        overflow-wrap: anywhere;
    }
    .bp-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-info {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-info :global(svg) {
        flex: none;
        margin-top: 1px;
    }
    .bp-radio {
        flex: none;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.35);
    }
    .bp-radio.on {
        background: radial-gradient(circle, #fff 0 4px, #6d4aff 5px);
        box-shadow: none;
    }
    .bp-m {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-warn {
        color: #f5c451;
    }
    .bp-select {
        position: relative;
        display: block;
    }
    .bp-select select {
        width: 100%;
        height: 44px;
        margin: 0;
        padding: 0 36px 0 12px;
        border: 0;
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        font: inherit;
        font-size: 14px;
        color: #fff;
        appearance: none;
        cursor: pointer;
        outline: none;
    }
    .bp-select select:focus-visible {
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.6);
    }
    .bp-select select option {
        background: #14121e;
        color: #fff;
    }
    .bp-select :global(svg) {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        color: rgba(244, 242, 250, 0.64);
        pointer-events: none;
    }
</style>
