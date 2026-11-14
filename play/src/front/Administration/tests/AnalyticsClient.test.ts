import { beforeEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => ({
    init: vi.fn(),
    identify: vi.fn(),
    capture: vi.fn(),
    reset: vi.fn(),
    get_distinct_id: vi.fn(() => "anonymous-id"),
    get_property: vi.fn((): unknown => "anonymous"),
}));

vi.mock("posthog-js", () => ({ default: posthog }));
vi.mock("../../Enum/EnvironmentVariable", () => ({
    POSTHOG_API_KEY: "phc_test",
    POSTHOG_URL: "https://posthog.test",
}));

import { analyticsClient } from "../AnalyticsClient";

/** The client sets PostHog up in a promise: let it settle. */
const settled = () =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });

describe("AnalyticsClient", () => {
    beforeEach(() => {
        posthog.identify.mockClear();
        posthog.capture.mockClear();
        posthog.reset.mockClear();
        posthog.get_distinct_id.mockReturnValue("anonymous-id");
        posthog.get_property.mockReturnValue("anonymous");
    });

    it("identifies by Orbit's id with nothing else about the person", async () => {
        analyticsClient.identifyUser("orbit-id-1");
        await settled();
        expect(posthog.identify).toHaveBeenCalledTimes(1);
        expect(posthog.identify).toHaveBeenCalledWith("orbit-id-1", { wa: true });
    });

    it("never identifies by an email, and leaves a person with no id anonymous", async () => {
        analyticsClient.identifyUser("sara@example.test");
        analyticsClient.identifyUser(null);
        analyticsClient.identifyUser(undefined);
        await settled();
        expect(posthog.identify).not.toHaveBeenCalled();
    });

    it("does not identify again somebody PostHog already knows by that id", async () => {
        posthog.get_distinct_id.mockReturnValue("orbit-id-1");
        analyticsClient.identifyUser("orbit-id-1");
        await settled();
        expect(posthog.identify).not.toHaveBeenCalled();
    });

    it("starts a browser that an earlier version identified by email again as an anonymous one, before PostHog's first request", async () => {
        await settled();
        const { loaded } = posthog.init.mock.calls[0][1];
        // It runs in PostHog's own `loaded` callback, which comes before its feature-flags request
        expect(typeof loaded).toBe("function");
        expect(posthog.reset).not.toHaveBeenCalled();

        posthog.get_distinct_id.mockReturnValue("sara@example.test");
        loaded(posthog);
        expect(posthog.reset).toHaveBeenCalledTimes(1);

        posthog.reset.mockClear();
        posthog.get_distinct_id.mockReturnValue("orbit-id-1");
        loaded(posthog);
        expect(posthog.reset).not.toHaveBeenCalled();
    });

    it("forgets who the browser was when Orbit gives no id, and leaves an anonymous browser alone", async () => {
        posthog.get_property.mockReturnValue("identified");
        analyticsClient.identifyUser(null);
        await settled();
        expect(posthog.get_property).toHaveBeenCalledWith("$user_state");
        expect(posthog.reset).toHaveBeenCalledTimes(1);
        expect(posthog.identify).not.toHaveBeenCalled();

        posthog.reset.mockClear();
        posthog.get_property.mockReturnValue("anonymous");
        analyticsClient.identifyUser(undefined);
        await settled();
        expect(posthog.reset).not.toHaveBeenCalled();
    });

    it("cleans the page address inside a session replay as well as in events", async () => {
        await settled();
        const { session_recording } = posthog.init.mock.calls[0][1];
        expect(
            session_recording.maskNetworkRequestFn({ url: "https://a.test/room?code=1#chatRoomId=!private:matrix" })
        ).toEqual({
            url: "https://a.test/room",
        });
    });

    it("sets PostHog up to mask text and inputs, record no console lines, and clean every event", async () => {
        await settled();
        const config = posthog.init.mock.calls[0][1];
        expect(config).toMatchObject({
            person_profiles: "identified_only",
            mask_all_text: true,
            enable_recording_console_log: false,
            session_recording: { maskAllInputs: true, maskTextSelector: "*" },
        });
        const cleaned = config.before_send({
            properties: { email: "sara@example.test", $current_url: "https://a.test/b?c=1" },
        });
        expect(cleaned.properties).toEqual({ $current_url: "https://a.test/b" });
    });

    it("tells nothing about the other person when a call starts", async () => {
        analyticsClient.addNewParticipant();
        await settled();
        expect(posthog.capture).toHaveBeenCalledWith("wa_spontaneous_discussion");
    });

    it("sends the address of an opened website without its query", async () => {
        analyticsClient.openedWebsite(new URL("https://example.test/page?invite=secret#frag"));
        await settled();
        expect(posthog.capture).toHaveBeenCalledWith("wa_opened_website", { url: "https://example.test/page" });
    });

    it("records a sign-out without resetting by itself", async () => {
        analyticsClient.logout();
        await settled();
        expect(posthog.capture).toHaveBeenCalledWith("wa_logout");
        expect(posthog.reset).not.toHaveBeenCalled();
    });

    it("starts the next person on the browser anonymous when the game forgets the person", async () => {
        analyticsClient.forgetPerson();
        await settled();
        expect(posthog.reset).toHaveBeenCalledTimes(1);
    });
});
