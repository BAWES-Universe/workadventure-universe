import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import {
    LOADING_FILES_DONE,
    LOADING_JOINED,
    LOADING_STARTED,
    loadingProgressStore,
    reportFilesProgress,
    reportJoinStep,
    startLoading,
} from "../LoaderStore";

describe("loadingProgressStore", () => {
    it("runs as one bar: start, files, then the five join steps", () => {
        startLoading();
        expect(get(loadingProgressStore)).toBe(LOADING_STARTED);
        reportFilesProgress(0.5);
        expect(get(loadingProgressStore)).toBeCloseTo((LOADING_STARTED + LOADING_FILES_DONE) / 2);
        reportFilesProgress(1);
        expect(get(loadingProgressStore)).toBeCloseTo(LOADING_FILES_DONE);
        for (const step of ["connection", "scripts", "woka", "map", "chat"] as const) reportJoinStep(step);
        expect(get(loadingProgressStore)).toBeCloseTo(LOADING_JOINED);
    });

    it("never goes back within one load, and counts each join step once", () => {
        startLoading();
        reportFilesProgress(1);
        reportFilesProgress(0.2);
        expect(get(loadingProgressStore)).toBeCloseTo(LOADING_FILES_DONE);
        reportJoinStep("map");
        const oneStep = get(loadingProgressStore);
        reportJoinStep("map");
        expect(get(loadingProgressStore)).toBe(oneStep);
        expect(oneStep).toBeGreaterThan(LOADING_FILES_DONE);
    });

    it("starts again for the next load", () => {
        startLoading();
        reportFilesProgress(1);
        reportJoinStep("connection");
        startLoading();
        expect(get(loadingProgressStore)).toBe(LOADING_STARTED);
        reportJoinStep("connection");
        expect(get(loadingProgressStore)).toBeGreaterThan(LOADING_STARTED);
    });
});
