<script lang="ts">
    // A small round button inside a group (Edit route, Add, Change).
    export let testId: string | undefined = undefined;
    export let danger = false;
    export let disabled = false;
</script>

<button type="button" class="bp-btn" class:danger {disabled} data-testid={testId} on:click><slot /></button>

<style>
    .bp-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        flex: none;
        height: 32px;
        margin: 0;
        padding: 0 12px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        white-space: nowrap;
        cursor: pointer;
    }
    .bp-btn.danger {
        color: #ff8a7a;
    }
    .bp-btn:disabled {
        opacity: 0.5;
        cursor: default;
    }
    @media (hover: hover) {
        .bp-btn:not(:disabled):hover {
            background: rgba(255, 255, 255, 0.14);
        }
        .bp-btn.danger:not(:disabled):hover {
            background: rgba(255, 112, 92, 0.16);
        }
    }
    .bp-btn:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
</style>
