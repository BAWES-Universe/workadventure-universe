import { defineConfig, devices } from "@playwright/test";

/**
 * Safety net: every automated row of checklist.json, run as a phone and as a desktop.
 * The game must already be running (stack/stack.sh, or SAFETY_NET_URL pointing at another build).
 */
const media = {
    permissions: ["camera", "microphone"],
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
};

export default defineConfig({
    testDir: "./specs",
    timeout: 120_000,
    expect: { timeout: 15_000 },
    // A failure is a real result: one retry only shows up as "flaky" in the report, never as a pass.
    retries: 1,
    workers: Number(process.env.SAFETY_NET_WORKERS || 2),
    fullyParallel: true,
    reporter: [
        ["list"],
        ["json", { outputFile: "results/results.json" }],
        ["html", { outputFolder: "results/html", open: "never" }],
    ],
    outputDir: "results/artifacts",
    use: {
        baseURL: process.env.SAFETY_NET_URL ?? "http://localhost:8000",
        locale: "en-US",
        actionTimeout: 15_000,
        navigationTimeout: 60_000,
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
    },
    projects: [
        {
            name: "phone",
            use: {
                ...devices["Pixel 7"],
                viewport: { width: 428, height: 926 },
                deviceScaleFactor: 2,
                hasTouch: true,
                isMobile: true,
                ...media,
            },
        },
        {
            name: "desktop",
            use: {
                ...devices["Desktop Chrome"],
                viewport: { width: 1440, height: 900 },
                ...media,
            },
        },
    ],
});
