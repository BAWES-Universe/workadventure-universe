<script lang="ts">
    // "What's sent", the explainer for Bot chat telemetry, in the bot module's dialog style (a dimmed page
    // and the raised surface), moved to the page's body so the panel does not clip it.
    import LL from "../../../../../i18n/i18n-svelte";

    export let onClose: () => void;

    $: info = $LL.mapEditor.edit.bots.page.telemetry.info;

    function portal(node: HTMLElement) {
        document.body.appendChild(node);
        return {
            destroy() {
                if (node.parentNode) node.parentNode.removeChild(node);
            },
        };
    }

    function onKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") onClose();
    }
</script>

<svelte:window on:keydown={onKeydown} />

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div
    role="presentation"
    class="tm-scrim fixed inset-0 bg-black/50 flex items-center justify-center p-4 pointer-events-auto"
    use:portal
    on:click={onClose}
>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bot-telemetry-info-title"
        class="tm-dialog u-surface w-full flex flex-col text-white"
        data-testid="bot-telemetry-info-dialog"
        on:click|stopPropagation
    >
        <div class="tm-body">
            <h2 id="bot-telemetry-info-title" class="tm-title">{info.title()}</h2>
            <p class="tm-lead">
                {info.lead()}
            </p>
            <div class="tm-group">
                <h3>{info.onTitle()}</h3>
                <ul>
                    <li>{info.on1()}</li>
                    <li>{info.on2()}</li>
                </ul>
            </div>
            <div class="tm-group">
                <h3>{info.offTitle()}</h3>
                <ul>
                    <li>{info.off1()}</li>
                    <li>{info.off2()}</li>
                </ul>
            </div>
            <div class="tm-group">
                <h3>{info.eitherTitle()}</h3>
                <ul>
                    <li>{info.either1()}</li>
                    <li>{info.either2()}</li>
                </ul>
            </div>
        </div>
        <div class="tm-foot">
            <button
                type="button"
                class="u-join-btn u-cta tm-close"
                data-testid="bot-telemetry-info-close"
                on:click={onClose}>{info.close()}</button
            >
        </div>
    </div>
</div>

<style>
    .tm-scrim {
        z-index: 3000;
    }
    .tm-dialog {
        max-width: 428px;
        max-height: 100%;
        overflow-y: auto;
        border-radius: 20px;
    }
    .tm-body {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 20px 20px 16px;
    }
    .tm-title {
        margin: 0;
        font-size: 1.25rem;
        line-height: 1.15;
        font-weight: 800;
        text-transform: none;
        letter-spacing: normal;
        color: #fff;
    }
    .tm-lead {
        margin: 0;
        font-size: 14px;
        line-height: 1.45;
        color: rgba(244, 242, 250, 0.82);
    }
    .tm-group h3 {
        margin: 0 0 4px;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.3;
        text-transform: none;
        letter-spacing: normal;
        color: #fff;
    }
    .tm-group ul {
        margin: 0;
        padding-inline-start: 18px;
        list-style: disc;
    }
    .tm-group li {
        font-size: 13.5px;
        line-height: 1.45;
        color: rgba(244, 242, 250, 0.82);
    }
    .tm-group li + li {
        margin-top: 2px;
    }
    .tm-foot {
        padding: 12px 16px 16px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(0, 0, 0, 0.2);
    }
    .tm-close {
        width: 100%;
        margin: 0;
        border: 0;
    }
</style>
