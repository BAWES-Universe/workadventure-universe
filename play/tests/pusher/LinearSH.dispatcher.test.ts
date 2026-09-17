import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceToFrontDispatcher } from "../../src/pusher/models/SpaceToFrontDispatcher";
import { deliverLinearSh } from "../../src/pusher/services/LinearShGateway";
vi.mock("../../src/pusher/services/LinearShGateway", () => ({
    deliverLinearSh: vi.fn(async (recipients, _space, _message, _proof, current, emit) => {
        await Promise.resolve();
        for (const socket of recipients) if (current(socket, "employee")) emit(socket, "Fictional protected task");
    }),
}));
afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
});
const chat = (proof?: string) => ({
    $case: "publicEvent",
    publicEvent: {
        senderUserId: "bot-socket",
        spaceName: "bubble",
        spaceEvent: {
            event: {
                $case: "spaceMessage",
                spaceMessage: {
                    message: "memory or generic text",
                    name: "spoofable name",
                    characterTextures: [],
                    galleryUrls: [],
                    fileNames: [],
                    ...(proof ? { linearShReply: proof } : {}),
                },
            },
        },
    },
});
describe("Linear SH production pusher hooks", () => {
    function dispatcher() {
        const emit = vi.fn();
        const socket = { getUserData: () => ({ emitInBatch: emit }) };
        const space = {
            name: "world.bubble",
            localName: "bubble",
            users: new Map([["bot-socket", { uuid: "bot-enrolled" }]]),
            _localConnectedUser: new Map([["employee", socket]]),
            _localConnectedUserWithSpaceUser: new Map([[socket, { spaceUserId: "employee" }]]),
        };
        const processPublicEvent = vi.fn((event) => event);
        // The production dispatcher accepts a much larger Space interface; only fanout state is used here.
        const d = new SpaceToFrontDispatcher(space as never, { processPublicEvent } as never);
        return { d, emit, processPublicEvent };
    }
    it("final dispatcher denies memory/plain output, sends authorized plaintext, strips proof/media, and preserves other bots", async () => {
        vi.stubEnv("LINEAR_SH_BOT_ID", "enrolled");
        const { d, emit, processPublicEvent } = dispatcher();
        d.handleMessage({ message: chat() } as never);
        expect(emit).not.toHaveBeenCalled();
        d.handleMessage({ message: chat("encrypted") } as never);
        await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(1));
        expect(deliverLinearSh).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(emit.mock.calls[0])).toContain("Fictional protected task");
        expect(JSON.stringify(emit.mock.calls[0])).not.toContain("linearShReply");
        expect(processPublicEvent).not.toHaveBeenCalled();
        vi.stubEnv("LINEAR_SH_BOT_ID", "another-bot");
        d.handleMessage({ message: chat() } as never);
        expect(emit).toHaveBeenCalledTimes(2);
        expect(processPublicEvent).toHaveBeenCalledTimes(1);
    });
    it("reply marker fails closed through the dedicated gateway even without the bot ID on this pusher", async () => {
        vi.stubEnv("LINEAR_SH_BOT_ID", "");
        const { d, processPublicEvent } = dispatcher();
        d.handleMessage({ message: chat("encrypted") } as never);
        await vi.waitFor(() => expect(deliverLinearSh).toHaveBeenCalledTimes(1));
        expect(processPublicEvent).not.toHaveBeenCalled();
    });
    it.each(["slow", "unavailable", "disabled"])(
        "ordinary separate-bubble output invokes its normal path once with Linear %s",
        (mode) => {
            vi.stubEnv("LINEAR_SH_BOT_ID", "elsewhere");
            vi.stubEnv("LINEAR_SH_ENABLED", mode === "disabled" ? "false" : "true");
            vi.mocked(deliverLinearSh).mockImplementationOnce(() =>
                mode === "slow" ? new Promise(() => {}) : Promise.reject(new Error("fixture unavailable"))
            );
            const { d, emit, processPublicEvent } = dispatcher();
            d.handleMessage({ message: chat() } as never);
            expect(emit).toHaveBeenCalledTimes(1);
            expect(processPublicEvent).toHaveBeenCalledTimes(1);
            expect(deliverLinearSh).not.toHaveBeenCalled();
            vi.mocked(deliverLinearSh).mockReset();
        }
    );
});
