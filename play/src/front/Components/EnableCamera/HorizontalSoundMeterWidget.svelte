<script lang="ts">
    export let spectrum: number[] | undefined = [0, 0, 0, 0, 0, 0, 0];

    const NB_BARS = 30;

    // Same green → yellow → red ramp and the same level as before; only the bars' shape changed (rounded, apart)
    function color(i: number, spectrum: number[] | undefined) {
        if (!spectrum || spectrum.length === 0) {
            spectrum = [0, 0, 0, 0, 0, 0, 0];
        }

        const red = (255 * i) / NB_BARS;
        const green = 255 * (1 - i / NB_BARS);
        const sumSpectrum = spectrum.reduce((a, b) => a + b, 0);
        const avgVolume = (sumSpectrum / spectrum.length) % 20;

        const alpha = i >= avgVolume ? 0.2 : 1;

        return "background-color:rgba(" + red + ", " + green + ", 0, " + alpha + ");";
    }
</script>

<div class="horizontal-sound-meter flex w-full gap-[3px] h-[14px]" aria-hidden="true">
    {#each [...Array(NB_BARS).keys()] as i (i)}
        <div class="flex-1 rounded-[3px]" style={color(i, spectrum)} />
    {/each}
</div>
