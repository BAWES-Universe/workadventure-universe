<script lang="ts">
    import { tick, onDestroy } from "svelte";
    import copyEn from "../../../i18n/en-US/questsProof";
    import type { QuestProofCopy } from "../../../i18n/en-US/questsProof";
    import { createQuestProofController } from "./QuestProofController";
    import type { QuestProofController } from "./QuestProofController";
    import { availablePaths, effectiveSurface, PATHS } from "./QuestProofModel";
    import type { QuestPath, QuestScenario } from "./QuestProofModel";
    import QuestStamp from "./QuestStamp.svelte";
    export let controller: QuestProofController = createQuestProofController();
    export let suppressed = false;
    export let returnFocus: (() => void) | undefined = undefined;
    export let showScenarios = true;
    export let embedded = false;
    export let bottomClearance: number | undefined = undefined;
    export let idleDelay = 60_000;
    export let copy: QuestProofCopy = copyEn;
    const SCENARIOS: QuestScenario[] = ["bot", "area", "none", "empty"];
    const GROUPS: Array<"tracked" | "accepted" | "available" | "done"> = ["tracked", "accepted", "available", "done"];
    let pillIdle = false;
    let pillButton: HTMLButtonElement;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    function wakePill() {
        clearTimeout(idleTimer);
        pillIdle = false;
        if (surface === "pill")
            idleTimer = setTimeout(() => {
                if (document.activeElement === pillButton) wakePill();
                else pillIdle = true;
            }, idleDelay);
    }
    $: wakeForSurface(surface, tracked);
    function wakeForSurface(_surface: string, _tracked: QuestPath | null) {
        wakePill();
    }
    onDestroy(() => clearTimeout(idleTimer));
    let walkthrough = false;
    let simulatedBusy = false;
    let controlsOpen = false;
    let panel: HTMLElement;
    let previousFocus: HTMLElement | null = null;
    let lastSurface = "";
    $: if (surface !== lastSurface) {
        lastSurface = surface;
        if (surface === "log") void focusLog();
    }
    async function focusLog() {
        if (document.activeElement instanceof HTMLElement && !panel?.contains(document.activeElement))
            previousFocus = document.activeElement;
        await tick();
        if (surface === "log") panel?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    }
    $: busy = suppressed || simulatedBusy;
    let revealQueued = false;
    let destroyed = false;
    onDestroy(() => {
        destroyed = true;
    });
    // Never write the subscribed store during Svelte's reactive update. A reentrant write can
    // persist the payoff while leaving the DOM on the previous card until an unrelated update.
    $: if ($controller.pending.length && !busy) scheduleReveal();
    function scheduleReveal() {
        if (revealQueued || destroyed) return;
        revealQueued = true;
        queueMicrotask(() => {
            revealQueued = false;
            if (!destroyed) controller.reveal(busy);
        });
    }
    $: surface = effectiveSurface($controller, busy);
    $: available = availablePaths($controller);
    $: tracked = $controller.tracked;
    $: if (surface !== "card") walkthrough = false;
    $: host =
        $controller.scenario === "bot" ? copy.hostBot : $controller.scenario === "area" ? copy.hostArea : copy.hostNone;
    $: pathCopy = {
        meet: {
            title: copy.meetTitle,
            short: copy.meetShort,
            action: copy.meetAction,
            instruction: copy.meetInstruction,
            stamp: copy.meetStamp,
            done: copy.meetDone,
            time: copy.twoMinutes,
        },
        explore: {
            title: copy.exploreTitle,
            short: copy.exploreShort,
            action: copy.exploreAction,
            instruction: copy.exploreInstruction,
            stamp: copy.exploreStamp,
            done: copy.exploreDone,
            time: copy.minute,
        },
        build: {
            title: copy.buildTitle,
            short: copy.buildShort,
            action: copy.buildAction,
            instruction: copy.buildInstruction,
            stamp: copy.buildStamp,
            done: copy.buildDone,
            time: copy.twoMinutes,
        },
    };
    function isAvailable(path: QuestPath) {
        return available.includes(path);
    }
    async function open(type: "options" | "show" | "log") {
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        controller.send({ type });
        await tick();
        panel?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    }
    function close() {
        controller.send({ type: "close" });
        if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus({ preventScroll: true });
        else returnFocus?.();
    }
    function onKeydown(event: KeyboardEvent) {
        if (event.key === "Escape" && ["log", "options", "card"].includes(surface)) {
            event.preventDefault();
            close();
        }
        if (event.key === "Tab" && surface === "log") {
            const elements = Array.from(panel.querySelectorAll<HTMLButtonElement>("button:not([disabled]), select"));
            const first = elements[0],
                last = elements[elements.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        }
    }
    function scenario(value: QuestScenario) {
        controller.send({ type: "reset", scenario: value });
    }
</script>

<div
    class="quest-proof"
    class:embedded
    class:modal-open={surface === "log"}
    style:--quest-clearance={bottomClearance === undefined ? undefined : `${bottomClearance}px`}
    data-testid="quest-proof"
    on:keydown|stopPropagation={onKeydown}
    on:pointerdown|stopPropagation
    on:mousedown|stopPropagation
    on:touchstart|stopPropagation
    on:click|stopPropagation
    role="presentation"
>
    {#if showScenarios}
        <aside class="proof-toolbar" aria-label={copy.proofControls}>
            <button class="proof-toggle" on:click={() => (controlsOpen = !controlsOpen)} aria-expanded={controlsOpen}
                ><span class="proof-dot" />{copy.proof}<span>{controlsOpen ? "−" : "+"}</span></button
            >
            <button class="toolbar-log" on:click={() => open("log")}>{copy.title}</button>
            {#if controlsOpen}
                <div class="proof-controls">
                    <p>{copy.proofDetail}</p>
                    <div class="scenario-grid">
                        {#each SCENARIOS as option (option)}
                            <button class:chosen={$controller.scenario === option} on:click={() => scenario(option)}
                                >{copy[option]}</button
                            >
                        {/each}
                    </div>
                    <div class="event-grid">
                        <button
                            on:click={() =>
                                controller.send({ type: "message", direction: "sent", session: $controller.session })}
                            >{copy.sendHello}</button
                        >
                        <button
                            on:click={() =>
                                controller.send({
                                    type: "message",
                                    direction: "received",
                                    session: $controller.session,
                                })}>{copy.receiveReply}</button
                        >
                        <button on:click={() => controller.send({ type: "area-entered" })}>{copy.visit}</button>
                        <button on:click={() => controller.send({ type: "safe-build-placed" })}>{copy.build}</button>
                        <button
                            on:click={() =>
                                controller.send({
                                    type: $controller.participantPresent ? "participant-left" : "participant-returned",
                                })}
                            >{$controller.participantPresent ? copy.participantLeave : copy.participantReturn}</button
                        >
                        <button on:click={() => controller.send({ type: "target-removed" })}>{copy.removeTarget}</button
                        >
                        <button on:click={() => controller.send({ type: "reconnect" })}>{copy.resume}</button>
                        <button on:click={() => scenario($controller.scenario)}>{copy.reset}</button>
                        <button class:chosen={simulatedBusy} on:click={() => (simulatedBusy = !simulatedBusy)}
                            >{copy.suppress}</button
                        >
                        <button
                            class:chosen={$controller.appointment}
                            on:click={() => controller.send({ type: "appointment", value: !$controller.appointment })}
                            >{copy.appointment}</button
                        >
                    </div>
                </div>
            {/if}
        </aside>
    {/if}
    {#if surface === "log"}<div class="log-scrim" aria-hidden="true" />{/if}
    <div class="quest-anchor" class:is-log={surface === "log"}>
        {#if surface === "invitation"}
            <section class="quest-card invitation" aria-label={copy.welcome} data-testid="quest-invitation">
                <div class="card-body invitation-body">
                    <div class="invitation-host">
                        <QuestStamp path="meet" />
                        <div class="eyebrow">{host}</div>
                    </div>
                    <h2>{copy.welcome}</h2>
                    <p class="muted detail">{copy.invitation}</p>
                    <button class="primary" on:click={() => open("options")}
                        >{copy.options}<span aria-hidden="true">↗</span></button
                    >
                    <button class="quiet full" on:click={() => controller.send({ type: "decline" })}
                        >{copy.notNow}</button
                    >
                </div>
            </section>
        {:else if surface === "options"}
            <section class="quest-card" bind:this={panel} aria-label={copy.choose} data-testid="quest-options">
                <header>
                    <button class="close" aria-label={copy.close} on:click={close}>×</button>
                    <div class="eyebrow">{host}</div>
                    <h2>{copy.choose}</h2>
                    <p class="muted">{copy.chooseDetail}</p>
                </header>
                <div class="path-list">
                    {#each available as path (path)}
                        <button
                            class="path"
                            on:click={() => controller.send({ type: "accept", path })}
                            data-testid="quest-accept-{path}"
                        >
                            <QuestStamp {path} /><span class="path-text"
                                ><strong>{pathCopy[path].title}</strong><span>{pathCopy[path].short}</span><small
                                    >{pathCopy[path].time}</small
                                ></span
                            ><span class="path-arrow" aria-hidden="true">↗</span>
                        </button>
                    {/each}
                    {#if !available.length}<p class="empty">{copy.noQuestsDetail}</p>{/if}
                </div>
                <footer>
                    <button class="quiet" on:click={() => open("log")}
                        >{copy.log}<span aria-hidden="true"> →</span></button
                    >
                </footer>
            </section>
        {:else if surface === "pill" && tracked}
            <button
                class="quest-pill"
                class:is-idle={pillIdle}
                bind:this={pillButton}
                on:click={() => open("show")}
                on:focus={wakePill}
                on:mouseenter={wakePill}
                aria-label={`${copy.title}: ${pathCopy[tracked].action}`}
                data-testid="quest-pill"
                ><span class="pill-glyph" aria-hidden="true">✦</span><span>{pathCopy[tracked].action}</span><span
                    class="pill-ring"
                    aria-hidden="true">↗</span
                ></button
            >
        {:else if surface === "card" && tracked}
            <section class="quest-card" bind:this={panel} aria-label={pathCopy[tracked].title} data-testid="quest-card">
                <header>
                    <button class="close" aria-label={copy.close} on:click={close}>×</button>
                    <div class="eyebrow">{copy.direction}</div>
                    <h2>{pathCopy[tracked].title}</h2>
                </header>
                <div class="card-body compact">
                    <div class="objective-art"><QuestStamp path={tracked} /><span>{pathCopy[tracked].time}</span></div>
                    {#if !isAvailable(tracked)}
                        <h3>{tracked === "meet" ? copy.noParticipant : copy.targetMissing}</h3>
                        <p class="muted">{tracked === "meet" ? copy.noParticipantDetail : copy.targetMissingDetail}</p>
                        <button class="primary" on:click={() => open("log")}>{copy.switch}<span>→</span></button>
                    {:else}
                        <p class="instruction">{pathCopy[tracked].instruction}</p>
                        {#if tracked === "meet" && $controller.exchange.sent}<p class="progress-note">
                                {copy.sent}
                            </p>{/if}
                        {#if tracked === "meet" && $controller.exchange.received && !$controller.exchange.sent}<p
                                class="progress-note"
                            >
                                {copy.received}
                            </p>{/if}
                        {#if !walkthrough}
                            <button class="primary" on:click={() => (walkthrough = true)}
                                >{pathCopy[tracked].action}<span aria-hidden="true">↗</span></button
                            >
                        {/if}
                        {#if walkthrough}
                            <div class="walkthrough" data-testid="quest-walkthrough">
                                <div class="eyebrow">{copy.practicePreview}</div>
                                {#if tracked === "meet"}
                                    {#if $controller.exchange.sent}<p class="speech own">{copy.previewHello}</p>{/if}
                                    {#if $controller.exchange.received}<p class="speech">{copy.previewReply}</p>{/if}
                                    <button
                                        class="preview-action"
                                        on:click={() =>
                                            controller.send({
                                                type: "message",
                                                direction: $controller.exchange.sent ? "received" : "sent",
                                                session: $controller.session,
                                            })}
                                        >{$controller.exchange.sent ? copy.playReply : copy.sendHello}<span
                                            aria-hidden="true">→</span
                                        ></button
                                    >
                                {:else if tracked === "explore"}
                                    <div class="practice-garden" aria-hidden="true">
                                        <span>✦</span><i /><i /><i /><i /><b />
                                    </div>
                                    <button
                                        class="preview-action"
                                        on:click={() => controller.send({ type: "area-entered" })}
                                        >{copy.stepInside}<span aria-hidden="true">→</span></button
                                    >
                                {:else}
                                    <div class="practice-grid" aria-hidden="true"><span>+</span></div>
                                    <button
                                        class="preview-action"
                                        on:click={() => controller.send({ type: "safe-build-placed" })}
                                        >{copy.placePlant}<span aria-hidden="true">+</span></button
                                    >
                                {/if}
                                <p class="simulation-note">{copy.simulated}</p>
                            </div>
                        {/if}
                    {/if}
                    <div class="secondary-actions">
                        <button class="quiet" on:click={() => open("log")}>{copy.log}</button><button
                            class="quiet"
                            on:click={() => controller.send({ type: "untrack" })}>{copy.stop}</button
                        >
                    </div>
                </div>
            </section>
        {:else if surface === "payoff" && $controller.payoff}
            {@const path = $controller.payoff}
            <section class="quest-card payoff" aria-label={pathCopy[path].stamp} data-testid="quest-payoff">
                <div class="payoff-art">
                    <div class="payoff-glow" />
                    <QuestStamp {path} large /><span aria-hidden="true" class="payoff-star">✦</span>
                </div>
                <div class="card-body">
                    <div class="eyebrow">{copy.stampCaption}</div>
                    <h2>{pathCopy[path].stamp}</h2>
                    <p class="lead">{pathCopy[path].done}</p>
                    <p class="muted detail">{copy.saved}</p>
                    <button
                        class="primary"
                        on:click={() => {
                            controller.send({ type: "settle" });
                            if (available.length) controller.send({ type: "options" });
                        }}>{available.length ? copy.another : copy.backToWorld}<span>↗</span></button
                    >{#if available.length}<button
                            class="quiet full"
                            on:click={() => controller.send({ type: "settle" })}>{copy.backToWorld}</button
                        >{/if}
                </div>
            </section>
        {:else if surface === "log"}
            <section
                class="quest-card quest-log"
                role="dialog"
                aria-modal="true"
                aria-label={copy.log}
                bind:this={panel}
                data-testid="quest-log"
            >
                <header>
                    <button class="close" aria-label={copy.close} on:click={close}>×</button>
                    <div class="eyebrow">{copy.title}</div>
                    <h2>{copy.log}</h2>
                    <p class="muted">{copy.logDetail}</p>
                </header>
                <div class="log-content">
                    {#if $controller.scenario === "empty"}<div class="empty">
                            <QuestStamp path="explore" large />
                            <h3>{copy.noQuests}</h3>
                            <p>{copy.noQuestsDetail}</p>
                        </div>{/if}
                    {#each GROUPS as group (group)}
                        {@const rows = PATHS.filter((path) =>
                            group === "tracked"
                                ? path === tracked && !$controller.quests[path].done
                                : group === "accepted"
                                ? $controller.quests[path].accepted &&
                                  !$controller.quests[path].done &&
                                  path !== tracked
                                : group === "available"
                                ? available.includes(path) && !$controller.quests[path].accepted
                                : $controller.quests[path].done
                        )}
                        {#if rows.length}
                            <h3 class="section-title">{copy[group]}<span>{rows.length}</span></h3>
                            {#each rows as path (path)}
                                <div class="log-row" class:complete={$controller.quests[path].done}>
                                    <QuestStamp {path} />
                                    <div class="log-row-content">
                                        <strong
                                            >{$controller.quests[path].done
                                                ? pathCopy[path].stamp
                                                : pathCopy[path].title}</strong
                                        >
                                        <p>
                                            {$controller.quests[path].done
                                                ? pathCopy[path].done
                                                : !isAvailable(path)
                                                ? copy.unavailable
                                                : pathCopy[path].short}
                                        </p>
                                        {#if !$controller.quests[path].done}<button
                                                class="row-action"
                                                on:click={() => controller.send({ type: "accept", path })}
                                                >{path === tracked ? copy.continue : copy.track}<span aria-hidden="true"
                                                    >↗</span
                                                ></button
                                            >{/if}
                                    </div>
                                    {#if $controller.quests[path].done}<span class="check" aria-hidden="true">✓</span
                                        >{/if}
                                </div>
                            {/each}
                        {/if}
                    {/each}
                    <div class="keep-card">
                        <span aria-hidden="true">✧</span>
                        <div>
                            <strong>{copy.keep}</strong>
                            <p>{copy.keepDetail}</p>
                            <small>{copy.previewOnly}</small>
                        </div>
                    </div>
                </div>
                <footer>
                    <button
                        class="quiet"
                        on:click={() => controller.send({ type: $controller.hidden ? "restore" : "hide" })}
                        >{$controller.hidden ? copy.restore : copy.hide}</button
                    ><span class="local-label">{copy.proof}</span>
                </footer>
            </section>
        {/if}
    </div>
</div>

<style>
    .quest-proof {
        position: absolute;
        inset: 0;
        z-index: 100;
        --q-ink: #f3f0fc;
        --q-muted: #b7b5cc;
        --q-gold: #e8cc95;
        --q-line: #a6a0e128;
        color: var(--q-ink);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
        isolation: isolate;
        pointer-events: none;
        font-size: 1rem;
        line-height: 1.5;
    }
    .quest-proof.modal-open {
        z-index: 500;
    }
    .quest-proof :global(*) {
        box-sizing: border-box;
    }
    .quest-proof button {
        font: inherit;
        cursor: pointer;
        touch-action: manipulation;
        color: inherit;
        border: 0;
        min-height: 44px;
    }
    .quest-proof button:focus-visible {
        outline: 3px solid #e8cc95;
        outline-offset: 3px;
    }
    .quest-proof button:disabled {
        opacity: 0.5;
        cursor: default;
    }
    .quest-proof h2,
    .quest-proof h3,
    .quest-proof p {
        margin: 0;
    }
    .quest-proof h2 {
        font-size: 1.65em;
        line-height: 1.15;
        letter-spacing: -0.045em;
        font-weight: 650;
    }
    .quest-proof h3 {
        font-size: 1em;
        font-weight: 600;
    }
    .quest-proof .muted {
        color: var(--q-muted);
        font-size: 0.875em;
    }
    .quest-anchor {
        position: absolute;
        top: 16px;
        inset-inline-start: 20px;
        bottom: var(--quest-clearance, 22px);
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        width: min(360px, calc(100% - 40px));
        pointer-events: none;
        z-index: 55;
    }
    .quest-anchor.is-log {
        z-index: 400;
        width: min(410px, calc(100% - 40px));
    }
    .quest-card {
        pointer-events: auto;
        border: 1px solid var(--q-line);
        background: linear-gradient(140deg, #23233bee, #111524f5 60%);
        box-shadow: 0 24px 75px #0007, inset 0 1px #ffffff0a;
        border-radius: 24px;
        overflow: auto;
        flex: 0 1 auto;
        min-height: 0;
        max-height: 100%;
        backdrop-filter: blur(24px);
        animation: quest-arrive 0.26s ease-out;
    }
    .quest-card header {
        position: relative;
        padding: 25px 24px 14px;
    }
    .quest-card header h2 {
        padding-inline-end: 20px;
        margin: 7px 0 10px;
    }
    .quest-card header .eyebrow {
        padding-inline-end: 42px;
    }
    .close {
        position: absolute;
        inset-inline-end: 8px;
        top: 8px;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: transparent;
        font-size: 1.7em !important;
        font-weight: 300;
        color: #bcbace !important;
    }
    .close:hover {
        background: #ffffff0a;
    }
    .eyebrow {
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-size: 0.62em;
        font-weight: 650;
        color: var(--q-gold);
        display: flex;
        gap: 7px;
        align-items: center;
        line-height: 1.6;
    }
    .card-body {
        padding: 0 24px 15px;
    }
    .card-body h2 {
        margin: 9px 0 12px;
    }
    .card-body.compact {
        padding-top: 0;
    }
    .lead {
        font-size: 0.96em;
        color: #dedcec;
        line-height: 1.6;
    }
    .detail {
        margin-top: 9px !important;
        margin-bottom: 21px !important;
    }
    .primary {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 15px;
        width: 100%;
        border-radius: 13px;
        padding: 13px 16px;
        background: linear-gradient(110deg, #7970db, #6158bc);
        box-shadow: inset 0 1px #ffffff22;
        font-weight: 600 !important;
        font-size: 0.88em !important;
        text-align: start;
        min-height: 50px !important;
    }
    .primary:hover {
        background: linear-gradient(110deg, #8b83e9, #7269cc);
    }
    .primary span {
        font-size: 1.2em;
        font-weight: 400;
    }
    .quiet {
        background: transparent;
        color: #c3bfd8 !important;
        border-radius: 9px;
        font-size: 0.8em !important;
        padding: 10px 6px;
    }
    .quiet:hover {
        color: #fff !important;
        background: #ffffff06;
    }
    .full {
        width: 100%;
        margin-top: 3px;
    }
    .invitation-body {
        padding-top: 17px;
    }
    .invitation-host {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-bottom: 9px;
    }
    .invitation-host :global(svg) {
        width: 30px;
        height: 30px;
    }
    .invitation h2 {
        font-size: 1.23em;
        line-height: 1.3;
        letter-spacing: -0.025em;
        margin-top: 0;
    }
    .invitation .detail {
        margin-bottom: 15px !important;
    }
    .path-list {
        padding: 5px 12px 10px;
    }
    .path {
        width: 100%;
        background: transparent;
        border-radius: 17px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 14px 9px !important;
        text-align: start;
        border: 1px solid transparent !important;
    }
    .path + .path {
        margin-top: 4px;
        border-top-color: var(--q-line) !important;
        border-radius: 0 0 16px 16px;
    }
    .path:hover {
        background: #8b7bd915;
        border-color: #a59ad536 !important;
        border-radius: 16px;
    }
    .path :global(svg) {
        width: 53px;
        height: 53px;
    }
    .path-text {
        display: flex;
        flex-direction: column;
        gap: 5px;
        flex: 1;
        min-width: 0;
    }
    .path strong {
        font-size: 0.95em;
        font-weight: 600;
    }
    .path-text > span {
        font-size: 0.75em;
        color: var(--q-muted);
        line-height: 1.5;
    }
    .path small {
        font-size: 0.64em;
        color: #9e96bd;
    }
    .path-arrow {
        color: #ccc2ee;
        font-size: 1.15em;
    }
    .quest-card footer {
        border-top: 1px solid var(--q-line);
        padding: 6px 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
    }
    .quest-pill {
        align-self: flex-start;
        flex-shrink: 0;
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 12px;
        max-width: 100%;
        text-align: start;
        padding: 10px 14px 10px 11px;
        border: 1px solid #b7a6ee40 !important;
        border-radius: 50px;
        background: linear-gradient(120deg, #2b2842ef, #181c2bef);
        box-shadow: 0 12px 40px #0004;
        backdrop-filter: blur(18px);
        font-size: 0.86em !important;
    }
    .quest-pill.is-idle {
        width: 48px;
        min-height: 48px;
        padding: 9px;
        gap: 0;
    }
    .quest-pill.is-idle > span:nth-child(2),
    .quest-pill.is-idle .pill-ring {
        display: none;
    }
    .quest-pill > span:nth-child(2) {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .pill-glyph {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: #c0a5ea16;
        color: var(--q-gold);
        display: grid;
        place-items: center;
        flex: none;
    }
    .pill-ring {
        width: 24px;
        height: 24px;
        border: 1px solid #b9a9de45;
        display: grid;
        place-items: center;
        border-radius: 50%;
        flex: none;
        font-size: 0.8em;
    }
    .objective-art {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: 0 0 12px;
    }
    .objective-art span {
        color: var(--q-muted);
        font-size: 0.7em;
    }
    .instruction {
        font-size: 0.94em;
        line-height: 1.65;
        margin-bottom: 20px !important;
        color: #e2dfee;
    }
    .compact > .muted {
        margin: 7px 0 20px;
    }
    .progress-note {
        margin-bottom: 16px !important;
        padding: 10px 12px;
        background: #b3a1eb0c;
        border-inline-start: 2px solid #ae9cdb;
        border-radius: 4px;
        font-size: 0.78em;
        color: #d9cdee;
    }
    .simulation-note {
        font-size: 0.65em;
        color: #a09aaf;
        margin: 9px 0 2px !important;
    }
    .secondary-actions {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        margin-top: 9px;
        flex-wrap: wrap;
    }
    .payoff {
        text-align: center;
    }
    .payoff-art {
        height: 160px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
    }
    .payoff-glow {
        position: absolute;
        inset: 15px 20px;
        background: radial-gradient(ellipse, #c89a5326, transparent 66%);
    }
    .payoff-star {
        position: absolute;
        top: 30px;
        inset-inline-end: 24%;
        color: var(--q-gold);
        font-size: 0.7em;
    }
    .payoff .eyebrow {
        justify-content: center;
    }
    .payoff h2 {
        font-size: 2em;
    }
    .payoff .lead {
        font-size: 0.92em;
    }
    .payoff .detail {
        font-size: 0.7em;
    }
    .payoff :global(.quest-stamp) {
        animation: stamp-settle 0.6s cubic-bezier(0.2, 0.7, 0.2, 1);
    }
    .quest-log {
        max-height: 100%;
    }
    .log-content {
        padding: 0 21px 16px;
    }
    .section-title {
        display: flex;
        justify-content: space-between;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: #aaa3c0;
        font-size: 0.65em !important;
        padding: 18px 0 10px;
    }
    .section-title span {
        font-size: 1.1em;
        color: #ded6f1;
    }
    .log-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 12px 0;
        border-bottom: 1px solid #ffffff08;
    }
    .log-row :global(svg) {
        width: 50px;
        height: 50px;
    }
    .log-row-content {
        flex: 1;
        min-width: 0;
    }
    .log-row strong {
        font-size: 0.9em;
        font-weight: 550;
    }
    .log-row p {
        font-size: 0.76em;
        color: var(--q-muted);
        margin-top: 4px;
    }
    .row-action {
        background: transparent;
        padding: 8px 0;
        font-size: 0.74em !important;
        color: #bcb0f5 !important;
        display: flex;
        gap: 12px;
        align-items: center;
    }
    .check {
        font-size: 0.85em;
        color: var(--q-gold);
        margin-top: 9px;
    }
    .keep-card {
        margin-top: 22px;
        border: 1px solid var(--q-line);
        border-radius: 16px;
        padding: 15px;
        display: flex;
        gap: 10px;
        background: linear-gradient(120deg, #62529611, transparent);
    }
    .keep-card > span {
        font-size: 1.4em;
        color: #c6b8ee;
    }
    .keep-card strong {
        font-size: 0.75em;
    }
    .keep-card p {
        font-size: 0.7em;
        color: var(--q-muted);
        margin: 5px 0;
    }
    .keep-card small {
        font-size: 0.63em;
        color: #8f8aa2;
    }
    .local-label {
        font-size: 0.48em;
        letter-spacing: 0.1em;
        color: #827c95;
    }
    .empty {
        text-align: center;
        padding: 24px 4px;
        color: var(--q-muted);
    }
    .empty h3 {
        color: var(--q-ink);
        margin: 15px 0 10px;
    }
    .empty p {
        font-size: 0.84em;
    }
    .log-scrim {
        position: absolute;
        inset: 0;
        background: #05071570;
        backdrop-filter: blur(3px);
        z-index: 390;
        pointer-events: auto;
    }
    .proof-toolbar {
        position: absolute;
        top: 14px;
        inset-inline-start: 16px;
        z-index: 600;
        pointer-events: auto;
        display: flex;
        flex-wrap: wrap;
        width: min(350px, calc(100% - 32px));
        align-items: center;
        gap: 6px;
    }
    .proof-toggle,
    .toolbar-log {
        font-size: 0.58em !important;
        letter-spacing: 0.08em;
        background: #141926ec;
        border: 1px solid #ffffff14 !important;
        border-radius: 9px;
        padding: 6px 10px;
        display: flex;
        align-items: center;
        gap: 9px;
        min-height: 34px !important;
    }
    .proof-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: #dec795;
    }
    .proof-controls {
        width: 100%;
        padding: 12px;
        border: 1px solid var(--q-line);
        border-radius: 12px;
        background: #121625fa;
        max-height: calc(100dvh - 210px);
        overflow: auto;
        box-shadow: 0 15px 30px #0006;
    }
    .proof-controls p {
        font-size: 0.65em;
        color: var(--q-muted);
        margin-bottom: 12px;
    }
    .scenario-grid,
    .event-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 5px;
    }
    .scenario-grid {
        margin-bottom: 10px;
    }
    .proof-controls button {
        background: #ffffff07;
        border: 1px solid #ffffff0b !important;
        border-radius: 7px;
        padding: 7px;
        font-size: 0.68em !important;
        text-align: start;
    }
    .proof-controls .chosen {
        background: #9781d62a;
        border-color: #b8a0eb66 !important;
    }
    .embedded {
        position: absolute;
        inset: 0;
    }
    .embedded .quest-anchor {
        bottom: var(--quest-clearance, 98px);
    }
    .embedded .quest-card {
        max-height: 100%;
    }
    .embedded .quest-anchor.is-log {
        bottom: var(--quest-clearance, 88px);
    }
    .embedded .quest-log {
        max-height: 100%;
    }
    .walkthrough {
        margin-top: 16px;
        padding: 14px;
        border: 1px solid var(--q-line);
        border-radius: 14px;
        background: #070d172e;
    }
    .speech {
        padding: 10px 12px;
        border-radius: 12px 12px 12px 3px;
        background: #ffffff08;
        font-size: 0.8em;
        margin-top: 12px !important;
    }
    .speech.own {
        border-radius: 12px 12px 3px 12px;
        background: #8d75c327;
    }
    .preview-action {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
        background: #b09ada20;
        border: 1px solid #b9a2e12f !important;
        padding: 10px;
        border-radius: 9px;
        margin-top: 12px;
        font-size: 0.8em !important;
        text-align: start;
    }
    .practice-garden {
        height: 86px;
        position: relative;
        overflow: hidden;
        border-radius: 12px;
        margin-top: 12px;
        background: linear-gradient(120deg, #193e3b, #142c31);
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .practice-garden span {
        color: #e8cc95;
        font-size: 1.6em;
        z-index: 1;
    }
    .practice-garden i {
        position: absolute;
        display: block;
        width: 34px;
        height: 34px;
        background: #367e6580;
        border-radius: 50%;
        top: 9px;
        left: 10%;
    }
    .practice-garden i:nth-of-type(2) {
        left: 70%;
        top: 40px;
    }
    .practice-garden i:nth-of-type(3) {
        left: 28%;
        top: 51px;
    }
    .practice-garden i:nth-of-type(4) {
        left: 82%;
        top: -7px;
    }
    .practice-garden b {
        position: absolute;
        inset: 0 44%;
        background: #d9c19a14;
        transform: rotate(30deg);
    }
    .practice-grid {
        height: 80px;
        margin-top: 12px;
        background-color: #222637;
        background-image: linear-gradient(#ffffff06 1px, transparent 1px),
            linear-gradient(90deg, #ffffff06 1px, transparent 1px);
        background-size: 20px 20px;
        border-radius: 10px;
        display: grid;
        place-items: center;
    }
    .practice-grid span {
        color: var(--q-gold);
        width: 38px;
        height: 38px;
        border: 1px dashed var(--q-gold);
        display: grid;
        place-items: center;
        border-radius: 7px;
    }
    @keyframes quest-arrive {
        from {
            opacity: 0;
            transform: translateY(8px);
        }
        to {
            opacity: 1;
            transform: none;
        }
    }
    @keyframes stamp-settle {
        from {
            opacity: 0;
            transform: scale(1.15) rotate(-12deg);
        }
        to {
            opacity: 1;
            transform: scale(1) rotate(-7deg);
        }
    }
    @media (max-width: 600px) {
        .quest-anchor {
            inset-inline-start: 12px;
            bottom: var(--quest-clearance, calc(104px + env(safe-area-inset-bottom, 0px)));
            width: calc(100% - 24px);
        }
        .quest-anchor.is-log {
            inset-inline-start: 8px;
            width: calc(100% - 16px);
            bottom: var(--quest-clearance, calc(88px + env(safe-area-inset-bottom, 0px)));
        }
        .quest-card {
            max-height: 100%;
            border-radius: 21px;
        }
        .quest-card header {
            padding: 22px 21px 11px;
        }
        .card-body {
            padding-inline: 21px;
        }
        .quest-log {
            max-height: 100%;
        }
        .embedded .quest-anchor {
            bottom: var(--quest-clearance, 104px);
        }
        .embedded .quest-anchor.is-log {
            bottom: var(--quest-clearance, 88px);
        }
        .quest-pill {
            max-width: calc(100% - 56px);
        }
        .proof-toolbar {
            top: 10px;
            inset-inline-start: 12px;
        }
        .quest-log footer {
            flex-wrap: wrap;
        }
        .path {
            padding-inline: 5px !important;
        }
        .path :global(svg) {
            width: 46px;
            height: 46px;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .quest-card,
        .payoff :global(.quest-stamp) {
            animation: none;
        }
    }
</style>
