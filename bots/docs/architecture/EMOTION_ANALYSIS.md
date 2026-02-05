# Unified AI Emotion Analysis

## Overview

Bot emotion analysis has been unified into the AI response generation itself. Instead of separate rule-based sentiment analysis, the AI now outputs emotion data directly with each response. This approach provides:

- **Zero extra latency** - Emotions are analyzed in the same AI call that generates the response
- **Better accuracy** - AI understands context, sarcasm, and nuance that rule-based systems miss
- **Single source of truth** - No separate EmotionAnalyzer service to maintain
- **Real-time updates** - Emotions are updated immediately after each message

## How It Works

### 1. AI System Prompt

When generating a response, the AI is instructed to output emotion analysis in a specific format:

```
After your response, output emotion analysis in this exact format:
[EMOTION_UPDATE]
{"personSentiment": -60, "isInsult": true, "insultSeverity": 7, "context": "angry"}
[/EMOTION_UPDATE]
```

### 2. Response Flow

```
Player Message → AI Generates Response + Emotions → Parse Response → Update Memory → Send Response
                         ↓
                [EMOTION_UPDATE] block extracted
                         ↓
              ConversationMemory.updateEmotionsFromAI()
```

### 3. Emotion Data Structure

The AI outputs:

| Field | Type | Description |
|-------|------|-------------|
| `personSentiment` | number (-100 to 100) | How the person seems to feel. Negative = angry/frustrated, Positive = happy/friendly |
| `isInsult` | boolean | Whether the message was an insult directed at the bot |
| `insultSeverity` | number (0-10) | How severe the insult was (0 = not an insult, 10 = extremely harsh) |
| `context` | string | Detected tone: "sarcastic", "joking", "sincere", "frustrated", "angry", "neutral" |

### 4. Emotion Parser

Located in `bots/ai/EmotionParser.ts`:

```typescript
import { parseEmotionsFromResponse } from '../ai/EmotionParser';

const { cleanedResponse, emotions } = parseEmotionsFromResponse(aiResponse);

// cleanedResponse: Response text with [EMOTION_UPDATE] block removed
// emotions: { personSentiment, isInsult, insultSeverity, context } or null
```

### 5. Memory Update

Located in `bots/memory/ConversationMemory.ts`:

```typescript
if (parsedResponse.emotions) {
    conversationMemory.updateEmotionsFromAI(botId, playerId, parsedResponse.emotions);
}
```

This method:
- Updates person's emotional state (anger, happiness, trust)
- Updates bot's emotional state in response
- Creates emotional wounds for severe insults
- Handles familiarity changes
- Applies wound modifiers (makes emotions "sticky" after negative experiences)

## Emotion Categories

### Person Emotion
- `anger` (0-100): How angry/frustrated the person seems
- `happiness` (0-100): How happy/positive the person seems
- `trust` (0-100): How much the person trusts the bot

### Bot Emotion
- `anger` (0-100): Bot's response to mistreatment
- `happiness` (0-100): Bot's mood based on interactions
- `trust` (0-100): How much the bot trusts the person
- `familiarity` (0-100): How well the bot knows the person

### Emotional Wounds
Severe insults (severity ≥ 4) create emotional wounds:
- `insult`: Direct insults ("you're an idiot")
- `cruelty`: Hateful messages ("I despise you")
- `betrayal`: Trust violations ("you're a liar")
- `abandonment`: Rejection messages ("go away")
- `disrespect`: General disrespect

Wounds:
- Heal slowly over time (1% per hour, max 90%)
- Make it harder to improve bot's emotions
- Create a "trust penalty" that persists
- Affect future interactions (bot remembers mistreatment)

## Testing

### Emotion Expectations

Test cases can include expected emotions:

```typescript
const testCase: TestCase = {
    id: 'insult-detection',
    name: 'Detect insult',
    botId: 'test-bot',
    chatInstructions: 'You are a friendly bot.',
    input: 'You are so stupid!',
    expectedEmotions: {
        personSentimentMin: -50,
        personSentimentMax: -80,
        isInsult: true,
        insultSeverityMin: 5,
        context: 'angry'
    }
};
```

### Test Results

Test results include detected emotions:

```typescript
const result: TestResult = {
    // ... other fields
    emotions: {
        personSentiment: -65,
        isInsult: true,
        insultSeverity: 7,
        context: 'angry'
    }
};
```

## Fallback Handling

If the AI fails to include the emotion block:
- Response is still sent to the player
- Emotions are left unchanged (no update)
- Warning is logged in development mode

This ensures graceful degradation - the conversation continues even if emotion parsing fails.

## Migration from Rule-Based

The previous rule-based system has been removed:
- ❌ `EmotionAnalyzer.ts` - Deleted
- ❌ `SENTIMENT_WORDS` dictionary - Removed
- ❌ `INSULT_PATTERNS` regex - Removed
- ❌ `analyzeSentiment()` method - Removed
- ❌ `updateEmotionsFromMessage()` method - Removed
- ❌ Background emotion analysis scheduling - Removed

Replaced with:
- ✅ `EmotionParser.ts` - Parses [EMOTION_UPDATE] blocks
- ✅ `updateEmotionsFromAI()` - Updates emotions from AI analysis
- ✅ AI system prompt instructions for emotion output

## Improving Emotion Detection

To improve emotion detection accuracy:

1. **Adjust AI prompt** in `AIService.ts` - Add more specific instructions
2. **Run tests** using the self-improvement framework
3. **Review test results** - Check detected emotions match expectations
4. **Tune thresholds** in `updateEmotionsFromAI()` for emotion changes

The self-improvement system can automatically test emotion detection and create tasks when accuracy is low.

## Files

| File | Purpose |
|------|---------|
| `bots/ai/EmotionParser.ts` | Parse emotions from AI response |
| `bots/ai/types.ts` | Type definitions for emotion data |
| `bots/ai/AIService.ts` | System prompt with emotion instructions |
| `bots/memory/ConversationMemory.ts` | `updateEmotionsFromAI()` method |
| `bots/behaviors/*.ts` | Behavior files that call emotion parsing |
| `bots/testing/BotTestRunner.ts` | Test runner with emotion validation |
| `bots/testing/types.ts` | Test types with emotion expectations |
