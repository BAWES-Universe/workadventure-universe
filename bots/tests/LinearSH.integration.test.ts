import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientToServerMessage } from "@workadventure/messages";
vi.mock("../services/FileParser", () => ({ FileParser: {} }));
vi.mock("../utils/BotPathfindingManager", () => ({
  BotPathfindingManager: vi.fn(),
}));
import { BotClient } from "../client/BotClient";

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
describe("Linear SH production dispatch hooks", () => {
  function client(botId = "enrolled", reserve = false) {
    const bot = Object.create(BotClient.prototype);
    const send = vi.fn();
    Object.assign(bot, {
      config: { botId },
      fullConfig: { behaviorConfig: { linearSh: reserve } },
      spaces: new Map([["bubble", "bot-socket"]]),
      ws: { readyState: 1, send },
      behavior: { onLinearShRequest: vi.fn().mockResolvedValue(undefined) },
    });
    return { bot, send };
  }
  it("blocks generic memory/stream output and sends only encrypted reply with a harmless placeholder", () => {
    vi.stubEnv("LINEAR_SH_BOT_ID", "enrolled");
    const { bot, send } = client();
    bot.send({ message: chat() });
    bot.send({
      message: {
        ...chat(),
        publicEvent: {
          ...chat().publicEvent,
          spaceEvent: {
            event: { $case: "spaceMessageComplete", spaceMessageComplete: {} },
          },
        },
      },
    });
    expect(send).not.toHaveBeenCalled();
    bot.sendLinearShReply("bubble", "encrypted-proof");
    const wire = ClientToServerMessage.decode(send.mock.calls[0][0]);
    expect(JSON.stringify(wire)).toContain("[Protected Linear SH reply]");
    expect(JSON.stringify(wire)).not.toContain("memory or generic text");
  });
  it("reserves the bot even when enrollment config is missing and keeps other bots unchanged", () => {
    vi.stubEnv("LINEAR_SH_BOT_ID", "");
    const reserved = client("reserved", true);
    reserved.bot.send({ message: chat() });
    expect(reserved.send).not.toHaveBeenCalled();
    const old = client("old-linear");
    old.bot.send({ message: chat() });
    expect(old.send).toHaveBeenCalledTimes(1);
  });
  it("ignores spoofed display identity and requires a server request proof before invoking the dedicated behavior", async () => {
    vi.stubEnv("LINEAR_SH_BOT_ID", "enrolled");
    const { bot } = client();
    await bot.handleSubMessage(chat());
    expect(bot.behavior.onLinearShRequest).not.toHaveBeenCalled();
    const input = chat();
    Object.assign(input.publicEvent.spaceEvent.event.spaceMessage, {
      linearShRequest: "server-proof",
    });
    await bot.handleSubMessage(input);
    expect(bot.behavior.onLinearShRequest).toHaveBeenCalledWith(
      "bubble",
      "bot-socket",
      "memory or generic text",
      "server-proof"
    );
  });
  it.each(["old-linear", "image", "music"])(
    "guest and employee chat still invokes the ordinary %s behavior/media path once",
    async (botId) => {
      vi.stubEnv("LINEAR_SH_BOT_ID", "enrolled-elsewhere");
      const { bot } = client(botId);
      const generate = vi.fn().mockResolvedValue("fixture-model-output");
      const media = vi.fn();
      const onChatMessage = vi.fn(async () => {
        await generate();
        media();
      });
      Object.assign(bot, {
        players: new Map(),
        behavior: { onChatMessage, onLinearShRequest: vi.fn() },
      });
      for (const logged of [false, true]) {
        generate.mockClear();
        media.mockClear();
        onChatMessage.mockClear();
        const input = chat();
        input.publicEvent.senderUserId = "fixture-room_17";
        Object.assign(input.publicEvent.spaceEvent.event.spaceMessage, {
          isLogged: logged,
        });
        await bot.handleSubMessage(input);
        await vi.waitFor(() => expect(media).toHaveBeenCalledTimes(1));
        expect(onChatMessage).toHaveBeenCalledTimes(1);
        expect(generate).toHaveBeenCalledTimes(1);
        expect(bot.behavior.onLinearShRequest).not.toHaveBeenCalled();
      }
    }
  );
});
