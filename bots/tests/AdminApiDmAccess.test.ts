import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { AdminApiService } from "../server/AdminApiService";

vi.mock("axios", () => ({ default: { post: vi.fn() } }));
vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));

const post = axios.post as unknown as ReturnType<typeof vi.fn>;
const ALICE = { uuid: "uuid-alice", name: "Alice" };

describe("AdminApiService.checkDmAccess", () => {
  let service: AdminApiService;

  beforeEach(() => {
    vi.stubEnv("BOT_SERVICE_TOKEN", "bot-token");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    service = new AdminApiService("http://orbit.test", "admin-token");
    post.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("asks Orbit's bot access check about a private chat, naming the person by their chat ID", async () => {
    post.mockResolvedValue({ status: 200, data: { allowed: true, code: "allowed", reason: null, person: ALICE } });
    expect(await service.checkDmAccess("bot 1", "@alice:matrix.test")).toEqual({
      allowed: true,
      reason: null,
      user: { ...ALICE, isGuest: false },
    });
    expect(post).toHaveBeenCalledWith(
      "http://orbit.test/api/bots/bot%201/access",
      { action: "dm", person: { signedIn: true, chatId: "@alice:matrix.test" } },
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer bot-token" }),
      })
    );
  });

  it.each(["not_allowed", "no_room_access", "sign_in_required", "unknown_person", "shared_chat_id", "banned"])(
    "passes Orbit's refusal %s on as the reason, with nobody named",
    async (code) => {
      post.mockResolvedValue({
        status: 200,
        // Even if Orbit named someone on a refusal, the bot server acts on nobody.
        data: { allowed: false, code, reason: "You can't message Guide now.", person: ALICE },
      });
      expect(await service.checkDmAccess("bot-1", "@alice:matrix.test")).toEqual({
        allowed: false,
        reason: code,
        user: null,
      });
    }
  );

  it("does not act on a yes that names nobody", async () => {
    for (const person of [undefined, null, {}, { uuid: "" }, { uuid: 42 }]) {
      post.mockResolvedValueOnce({ status: 200, data: { allowed: true, code: "allowed", reason: null, person } });
      expect(await service.checkDmAccess("bot-1", "@alice:matrix.test")).toEqual({
        allowed: false,
        reason: "admin_api_missing_user",
        user: null,
      });
    }
  });

  it("fails closed when Orbit errors, times out or answers oddly, and says so in a way the bridge reads as 'could not check'", async () => {
    post.mockRejectedValueOnce(Object.assign(new Error("Request failed with status code 500"), { response: { status: 500 } }));
    post.mockRejectedValueOnce(new Error("timeout of 4000ms exceeded"));
    post.mockResolvedValueOnce({ status: 200, data: { surprise: true } });
    for (let i = 0; i < 3; i++) {
      const result = await service.checkDmAccess("bot-1", "@alice:matrix.test");
      expect(result).toEqual({ allowed: false, reason: "admin_api_error", user: null });
    }
    // Reported, but not once per message while Orbit stays down.
    const sentry = await import("@sentry/node");
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("fails closed without asking when Orbit or the service token is not set up", async () => {
    vi.stubEnv("BOT_SERVICE_TOKEN", "");
    expect(await service.checkDmAccess("bot-1", "@alice:matrix.test")).toEqual({
      allowed: false,
      reason: "admin_api_not_configured",
      user: null,
    });
    vi.stubEnv("BOT_SERVICE_TOKEN", "bot-token");
    const unconfigured = new AdminApiService("", "");
    expect((await unconfigured.checkDmAccess("bot-1", "@alice:matrix.test")).reason).toBe("admin_api_not_configured");
    expect(post).not.toHaveBeenCalled();
  });
});
