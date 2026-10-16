<script lang="ts">
    // The on/off switch of the bot page (the bot itself, Goes to people).
    export let checked: boolean;
    export let label: string;
    export let disabled = false;
    export let testId: string | undefined = undefined;
    export let onChange: (checked: boolean) => void;
</script>

<input
    type="checkbox"
    role="switch"
    class="bp-switch"
    aria-label={label}
    title={label}
    {checked}
    {disabled}
    data-testid={testId}
    on:change={(e) => onChange(e.currentTarget.checked)}
/>

<style>
    .bp-switch {
        appearance: none;
        flex: none;
        width: 42px;
        height: 26px;
        margin: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.14);
        position: relative;
        cursor: pointer;
    }
    /* Hit area of 44 px around the 42 x 26 track, so it is easy to tap on a phone */
    .bp-switch::before {
        content: "";
        position: absolute;
        inset: -9px -1px;
    }
    .bp-switch::after {
        content: "";
        position: absolute;
        top: 3px;
        left: 3px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    }
    .bp-switch:checked {
        background: linear-gradient(90deg, #8629fc, #4156f6);
    }
    .bp-switch:checked::after {
        left: 19px;
    }
    .bp-switch:disabled {
        opacity: 0.6;
        cursor: default;
    }
    .bp-switch:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
</style>
