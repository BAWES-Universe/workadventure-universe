import { BaseBehavior } from "../behaviors/BaseBehavior";
import { LinearShMCP } from "../mcp/LinearShMCP";
import { LinearAdapter } from "./adapter";
import {
  LinearAssistant,
  directIntent,
  plannedIntent,
  JournalClient,
} from "./assistant";
import { Context, PolicyError, requireValue } from "./policy";

/** No inherited greetings, generic history, media flushing, repetition, or untrusted identity maps. */
export class LinearSHBehavior extends BaseBehavior {
  private assistant = new LinearAssistant();
  private active = new Map<string, AbortController>();
  private interaction?: string;
  update(): void {}
  protected async generateAIResponseStream(): Promise<void> {}
  onSpaceJoined(): void {}
  async onSpaceUserJoined(): Promise<void> {}
  onSpaceUserLeft(): void {}
  async onLinearShRequest(
    spaceName: string,
    senderId: string,
    message: string,
    ticket: string
  ): Promise<void> {
    const config = this.bot?.getFullConfig();
    const botId = config?.botId;
    if (
      !botId ||
      botId !== process.env.LINEAR_SH_BOT_ID ||
      process.env.LINEAR_SH_ENABLED !== "true" ||
      !ticket ||
      !this.adminApiService
    )
      return;
    const binding = { botId, ticket, spaceName, senderId, message };
    const resolve = () =>
      this.adminApiService!.linearSh({ ...binding, action: "resolve" });
    let context: Context;
    let token: string;
    try {
      ({ context, token } = await resolve());
    } catch {
      return;
    }
    const key = context.conversation;
    if (this.interaction !== context.interactionId) {
      for (const active of this.active.values()) active.abort();
      this.active.clear();
      this.assistant.clear();
      this.interaction = context.interactionId;
    }
    if (this.active.has(key)) {
      this.assistant.changed(context);
      this.active.get(key)!.abort();
      return; // No queued or overlapping writes/list replacement for one employee in one bubble.
    }
    const controller = new AbortController();
    this.active.set(key, controller);
    const current = async (requestId = "") => {
      requireValue(
        !controller.signal.aborted &&
          !!context.interactionId &&
          (await this.bot?.checkLinearShInteraction(
            spaceName,
            context.interactionId,
            requestId
          )),
        "Interaction ended; start a fresh request."
      );
    };
    let text: string;
    try {
      await current();
      const transport = new LinearShMCP(
        context.connectionId,
        context.subject,
        token,
        context.schemaHash,
        controller.signal,
        undefined,
        () =>
          this.adminApiService!.linearSh({ ...binding, action: "invalidate" })
      );
      await transport.initialize();
      const adapter = new LinearAdapter({
        call: async (tool, args) => {
          await current();
          return transport.call(tool, args);
        },
      });
      const call = (action: string, extra = {}) =>
        this.adminApiService!.linearSh({ ...binding, action, ...extra });
      const journal: JournalClient = {
        prepare: (items) => call("prepare", { items }),
        lookup: (id) => call("lookup", { id }),
        claim: (id, hash) => call("claim", { id, hash }),
        record: (id, index, outcome) => call("record", { id, index, outcome }),
        cancel: (id) => call("cancel", { id }),
      };
      let intent = directIntent(message);
      if (intent?.kind !== "confirm") this.assistant.changed(context);
      if (!intent) {
        requireValue(
          this.aiService && config.aiProviderRef,
          "Language interpretation unavailable"
        );
        intent = plannedIntent(
          await this.aiService.planLinearSh(
            config.aiProviderRef,
            message,
            context.teams ?? [],
            controller.signal
          )
        );
      }
      await current();
      text = await this.assistant.run(
        context,
        intent,
        adapter,
        journal,
        async () => (await resolve()).context,
        controller.signal,
        current
      );
    } catch (error) {
      text =
        error instanceof PolicyError
          ? error.message
          : "This request could not be completed safely. No automatic write retry will run. Check a confirmation by its code before repeating a write.";
    }
    try {
      await current();
      const sealed = await this.adminApiService.linearSh({
        ...binding,
        action: "seal",
        text,
      });
      await current();
      this.bot?.sendLinearShReply(spaceName, sealed.reply);
      await current(context.requestId);
      this.assistant.displayed(context);
    } catch {
      this.assistant.discard(context);
      /* Never fall back to public data or generic memory. */
    } finally {
      if (this.active.get(key) === controller) this.active.delete(key);
    }
  }
}
