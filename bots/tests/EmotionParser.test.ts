/**
 * Tests for EmotionParser — emotion block handling during streaming.
 *
 * Covers:
 *  - parseEmotionsFromResponse on complete messages
 *  - hasEmotionBlock detection
 *  - The [EM detection pattern used by behaviors for streaming chunks
 *    (beforeEmotion extraction, empty fragments, mixed content)
 */
import { describe, it, expect } from 'vitest';
import { parseEmotionsFromResponse, hasEmotionBlock } from '../ai/EmotionParser';

// --- parseEmotionsFromResponse (complete message, used on chunk.done) ---

describe('parseEmotionsFromResponse', () => {
    it('returns text unchanged when no emotion block present', () => {
        const result = parseEmotionsFromResponse('Hello world');
        expect(result.cleanedResponse).toBe('Hello world');
        expect(result.emotions).toBeNull();
    });

    it('strips complete emotion block and returns clean response', () => {
        const result = parseEmotionsFromResponse(
            'Paris, Khalid. You testing me?\n\n[EMOTION_UPDATE]\n{"personSentiment":0,"isInsult":false,"insultSeverity":0,"context":"sarcastic"}\n[/EMOTION_UPDATE]'
        );
        expect(result.cleanedResponse).toBe('Paris, Khalid. You testing me?');
        expect(result.emotions).not.toBeNull();
        expect(result.emotions?.personSentiment).toBe(0);
        expect(result.emotions?.isInsult).toBe(false);
        expect(result.emotions?.context).toBe('sarcastic');
    });

    it('preserves internal whitespace during trim (leading/trailing only)', () => {
        const result = parseEmotionsFromResponse('  Hello  world  ');
        expect(result.cleanedResponse).toBe('Hello  world');
    });
});

// --- hasEmotionBlock ---

describe('hasEmotionBlock', () => {
    it('detects complete emotion block', () => {
        expect(hasEmotionBlock('[EMOTION_UPDATE]\n{}\n[/EMOTION_UPDATE]')).toBe(true);
    });

    it('does not detect partial emotion tag', () => {
        expect(hasEmotionBlock('[EMOTION_UPD')).toBe(false);
        expect(hasEmotionBlock('[EM')).toBe(false);
    });

    it('returns false for normal text', () => {
        expect(hasEmotionBlock('Hello world')).toBe(false);
    });
});

// --- [EM detection pattern (used in behavior streaming loops) ---

describe('[EM fragment detection (behavior streaming pattern)', () => {
    /**
     * Replicates the pattern in IdleBehavior, PatrolBehavior, SocialBehavior
     * streaming loops (main + regeneration):
     *
     *   if (chunk.content.includes('[EM')) {
     *       const emotionIdx = chunk.content.indexOf('[EM');
     *       const beforeEmotion = chunk.content.substring(0, emotionIdx);
     *       if (beforeEmotion.trim()) {
     *           sendStreamMessage(beforeEmotion);
     *       }
     *       emotionBlockStarted = true;
     *   }
     */

    function extractBeforeEmotion(content: string): string | null {
        if (!content.includes('[EM')) return null;
        const emotionIdx = content.indexOf('[EM');
        const beforeEmotion = content.substring(0, emotionIdx);
        return beforeEmotion.trim() || null;
    }

    it('extracts text before [EMOTION_UPDATE] tag', () => {
        expect(extractBeforeEmotion('Paris, Khalid.[EMOTION_UPDATE]')).toBe('Paris, Khalid.');
    });

    it('extracts text before partial [EM fragment', () => {
        expect(extractBeforeEmotion('Some text[EM')).toBe('Some text');
    });

    it('does NOT match closing tag [/EMOTION_UPDATE] ([/EM lacks [EM substring)', () => {
        // '[/EMOTION_UPDATE]' does not contain '[EM' because
        // position 1 is '/' not '['. Closing is handled by
        // emotionBlockStarted already being true from the opening tag.
        expect(extractBeforeEmotion('[/EMOTION_UPDATE]')).toBeNull();
    });

    it('does NOT match partial closing tag [/EM', () => {
        expect(extractBeforeEmotion('[/EM')).toBeNull();
    });

    it('returns null when chunk starts with [EM (no preceding text)', () => {
        expect(extractBeforeEmotion('[EMOTION_UPDATE]')).toBeNull();
    });

    it('returns null for chunk with only [EM at start', () => {
        expect(extractBeforeEmotion('[EM')).toBeNull();
    });

    it('does not match [EM in normal text (no false positives)', () => {
        expect(extractBeforeEmotion('Hello world')).toBeNull();
    });

    it('extracts multiline text before emotion block', () => {
        const chunk = 'Line 1\nLine 2\n[EMOTION_UPDATE]\n{}\n[/EMOTION_UPDATE]';
        expect(extractBeforeEmotion(chunk)).toBe('Line 1\nLine 2');
    });

    it('handles text + emotion tag in single chunk (beforeEmotion capture)', () => {
        expect(extractBeforeEmotion('Some text[EMOTION_UPDATE]More text')).toBe('Some text');
        // 'More text' after the tag is lost — expected since the system
        // prompt puts the emotion block at the END of every response.
    });
});
