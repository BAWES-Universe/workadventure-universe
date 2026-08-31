/**
 * Vision-capable model detection for the in-game bot editor UI.
 *
 * Mirrors the bot runtime copy (bots/ai/providers/visionModels.ts) and the
 * admin-panel copy (workadventure-universe-admin/lib/vision-models.ts). The
 * play app cannot import from bots/ (separate package), so all three copies
 * must be kept in sync when the regex list changes.
 */

export const VISION_MODEL_REGEX =
    /(gemini|gpt-4o|gpt-4\.1|gpt-5|gpt-5\.|claude-3|claude-4|qwen[\d.]*-vl|glm-?[\d.]*v\b|llava|pixtral|vision|omni|kimi-?2\.?5)/i;

export function isVisionCapableModel(model: string): boolean {
    if (!model) return false;
    return VISION_MODEL_REGEX.test(model);
}

export function resolveVisionSupport(model: string, supportsVision: boolean | null | undefined): boolean {
    if (supportsVision === true) return true;
    if (supportsVision === false) return false;
    return isVisionCapableModel(model);
}
