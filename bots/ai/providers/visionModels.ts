/**
 * Vision-capable model detection for the bot runtime.
 *
 * The OpenAI-compatible protocol has no capability handshake — a model either
 * accepts image_url content blocks or errors on them. So we detect vision
 * support from the model name, with a manual tri-state override:
 *   - null/undefined = auto (regex decides)
 *   - true           = force vision
 *   - false          = force text-only
 *
 * NOTE: Keep the regex in sync with the admin-panel copy in workadventure-universe-admin
 * (lib/vision-models.ts). They cannot share code across repos, so both copies must be
 * updated together.
 */

export const VISION_MODEL_REGEX =
    /(gemini|gpt-4o|gpt-4\.1|gpt-5|gpt-5\.|claude-3|claude-4|qwen[\d.]*-vl|glm-?[\d.]*v\b|llava|pixtral|vision|omni|kimi-?2\.?5)/i;

/**
 * Whether a model name is known to be vision-capable (regex guess).
 */
export function isVisionCapableModel(model: string): boolean {
    if (!model) return false;
    return VISION_MODEL_REGEX.test(model);
}

/**
 * Resolve whether a provider config supports vision, honoring the tri-state override.
 */
export function resolveVisionSupport(
    model: string,
    supportsVision: boolean | null | undefined
): boolean {
    if (supportsVision === true) return true;
    if (supportsVision === false) return false;
    return isVisionCapableModel(model);
}
