/**
 * The rules of a person's own Brick in its direct messages: it knows what it is and what it has, acts first, never hands work back or
 * complains about what it lacks, and says where it is. Every other bot keeps the rules it always had.
 *
 * Each of these fails on the old prompt, which told a Brick it had "no room and no location", that nobody was around it, that it
 * could not see who was on the map, to track emotions, to stay in character and to call tools only "when you genuinely need information".
 */
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, ROOM_CARD_MARK } from '../ai/systemPrompt';
import { BRICK_CLOSING_REMINDER, BRICK_WORK_RULES, brickFollowUpRules } from '../ai/brickRules';
import { brickAbilitiesNote } from '../ai/BrickYou';
import { appToolDefinitions, offerableApps, topicOf } from '../ai/AppTools';
import { instantToolsNote } from '../ai/InstantTools';

const now = new Date('2026-11-26T12:00:00Z');
const MAP = '\n\nCurrent Location Context (you are always here):\n- Universe: BAWES\n- World: Hub\n- Room: Lobby\n- Areas in this room: Library, Social Area';
const brickNoRoom = buildSystemPrompt({ chatInstructions: 'You are Brick.', channel: 'dm', noRoom: true, brick: true, now });
const brickInRoom = buildSystemPrompt({ chatInstructions: 'You are Brick.', channel: 'dm', brick: true, mapContextInfo: MAP, now });

describe("A person's own Brick is told what it is and how it works", () => {
    it('acts first, and never hands work back or complains about what it lacks', () => {
        for (const prompt of [brickNoRoom, brickInRoom]) {
            expect(prompt).toContain("you are this person's own Brick");
            expect(prompt).toContain('Act first.');
            expect(prompt).toContain('Do not ask whether you may');
            expect(prompt).toContain('never hand work back to the person: do not tell them to look it up');
            expect(prompt).toContain('Never complain about what you lack');
            expect(prompt).toContain('Never say you cannot do something your list below says you can.');
        }
    });

    it('offers a Connect card straight away when a job needs an App it does not have', () => {
        expect(BRICK_WORK_RULES).toContain('offer to connect it in the same reply');
        expect(BRICK_WORK_RULES).toContain('before you try any other way round');
        // An App they said "not now" to is still never pushed
        expect(BRICK_WORK_RULES).toContain('already said not now to');
    });

    it('treats a picture as seen, tries its computer or an App on a bare link, and never says it is blind', () => {
        expect(BRICK_WORK_RULES).toContain('Use it as if you saw it.');
        expect(BRICK_WORK_RULES).toContain('open it with your computer if you have one');
        expect(BRICK_WORK_RULES).toContain('Never say you cannot see pictures.');
        expect(BRICK_WORK_RULES).toContain('Name the one thing that would make it possible and offer it');
    });

    it('says "Apps", never tools or connectors, and carries no vendor name or number', () => {
        expect(BRICK_WORK_RULES).toContain('Call them Apps, never tools, connectors or plugins.');
        expect(BRICK_WORK_RULES).not.toMatch(/composio|agent37|openai|anthropic|claude/i);
        expect(BRICK_WORK_RULES).not.toMatch(/\$\d|\d+ (messages|replies|requests)/i);
    });

    it('keeps what the app decides in the app: asking first and Off are never skipped', () => {
        expect(BRICK_WORK_RULES).toContain('The app asks the person itself when a step needs their yes');
        expect(BRICK_WORK_RULES).toContain('You never ask on its behalf and never skip it.');
        expect(BRICK_WORK_RULES).toContain('When a step is Off, or asks first, say so in one plain line');
    });

    it('drops the map character rules', () => {
        for (const prompt of [brickNoRoom, brickInRoom]) {
            expect(prompt).not.toContain('[EMOTION_UPDATE]');
            expect(prompt).not.toContain('EMOTION ANALYSIS');
            expect(prompt).not.toContain('genuinely need information');
            expect(prompt).not.toContain('YOUR PERSONALITY');
            expect(prompt).not.toContain('NEVER mention tools');
            expect(prompt).not.toContain('the wrong question');
            expect(prompt).not.toContain('HOW TO BE HUMAN-LIKE');
        }
    });

    it('ends with a short reminder to do the job, after the date', () => {
        expect(brickNoRoom.trimEnd().endsWith(BRICK_CLOSING_REMINDER.trim())).toBe(true);
        expect(brickNoRoom.indexOf('**NOW:**')).toBeLessThan(brickNoRoom.indexOf('**BEFORE YOU ANSWER:**'));
        expect(brickNoRoom).not.toContain('[EMOTION_UPDATE] block');
    });

    it('keeps its own voice from its instructions, which never excuse a refusal', () => {
        expect(brickNoRoom.startsWith('You are Brick.')).toBe(true);
        expect(brickNoRoom).toContain('They never make you skip a job');
    });
});

describe('Where a Brick is right now', () => {
    it('stands in a room: it is told its room, areas and who is there, and may send the room card', () => {
        expect(brickInRoom).toContain('**WHERE YOU ARE RIGHT NOW:**');
        expect(brickInRoom).toContain('lists the room, its world, its areas and who is there now');
        expect(brickInRoom).toContain(`end that reply with ${ROOM_CARD_MARK}`);
        expect(brickInRoom).toContain('- Room: Lobby');
        expect(brickInRoom).not.toContain('You have no room and no location');
        expect(brickInRoom).not.toContain('nobody is around you');
    });

    it('stands in no room: it says so plainly, never complains, and never sends a card', () => {
        expect(brickNoRoom).toContain('**WHERE YOU ARE RIGHT NOW:**');
        expect(brickNoRoom).toContain('not standing in a room on the map at the moment');
        expect(brickNoRoom).toContain(`never add ${ROOM_CARD_MARK} to a reply`);
        expect(brickNoRoom).not.toContain('You have no room and no location');
        expect(brickNoRoom).not.toContain('nobody is around you');
        expect(brickNoRoom).not.toContain('see who is on the map from here');
        expect(brickNoRoom).not.toContain('invite them to come find you in your room');
    });
});

describe('Everyone else keeps the rules they had', () => {
    const plain = (parts: Parameters<typeof buildSystemPrompt>[0]) => buildSystemPrompt({ chatInstructions: 'You are Brick.', now, ...parts });

    it('a guest Brick, a room bot and a bot on the map get exactly the old prompt', () => {
        const guestBrick = plain({ channel: 'dm', noRoom: true });
        expect(guestBrick).toContain('You have no room and no location, and nobody is around you.');
        expect(guestBrick).toContain('[EMOTION_UPDATE]');
        const roomBot = plain({ channel: 'dm' });
        expect(roomBot).toContain('You still live in the room named in your location context');
        expect(roomBot).toContain('genuinely need information');
        expect(plain({ channel: 'dm', brick: false })).toBe(roomBot);
    });

    it('the flag does nothing on the map, where a Brick standing in a room is a character as before', () => {
        expect(plain({ brick: true })).toBe(plain({}));
        expect(plain({ brick: true, noRoom: true })).toBe(plain({}));
    });
});

describe('The prompt cache', () => {
    it('shares the fixed rules between two people and two days, and only the tail changes', () => {
        const a = buildSystemPrompt({ chatInstructions: 'You are Brick.', channel: 'dm', brick: true, mapContextInfo: MAP, conversationContext: 'Recent conversation:\nThey: "hi"', now });
        const b = buildSystemPrompt({ chatInstructions: 'You are Brick.', channel: 'dm', brick: true, mapContextInfo: MAP, conversationContext: 'Recent conversation:\nThey: "yo"', now: new Date('2026-11-27T01:00:00Z') });
        const shared = (() => {
            let i = 0;
            while (i < a.length && i < b.length && a[i] === b[i]) i++;
            return i;
        })();
        expect(shared).toBeGreaterThanOrEqual(a.indexOf('\n\nConversation Context:'));
        expect(shared).toBeGreaterThan(a.indexOf('**WHERE YOU ARE RIGHT NOW:**'));
    });
});

describe('What a Brick is told it has', () => {
    const base = { apps: [], appsKnown: true, connectable: [], computer: false, reminders: false, instant: false, canOffer: true };

    it('lists its Apps, the ones it can connect in one tap, its computer and its reminders', () => {
        const note = brickAbilitiesNote({
            ...base,
            apps: ['Gmail', 'Google Calendar', 'gmail'],
            connectable: [
                { key: 'notion', name: 'Notion' },
                { key: 'slack', name: 'Slack' },
            ],
            computer: true,
            reminders: true,
            instant: true,
        });
        expect(note).toContain("You are this person's own Brick");
        expect(note).toContain('Apps you have: Gmail, Google Calendar.');
        expect(note).toContain('Apps you can connect in one tap: Notion, Slack.');
        expect(note).toContain('offer to connect it with offer_app in that same reply, before you try any other way');
        expect(note).toContain('You have your own computer.');
        expect(note).toContain('Instant Apps');
        expect(note).toContain('reminders, briefings, watches and goals');
        expect(note).toContain('What they turned Off for you stays off, and what asks first still asks.');
    });

    it('says so plainly when it has no Apps, and offers nothing it has no way to offer', () => {
        const note = brickAbilitiesNote({ ...base, canOffer: false });
        expect(note).toContain('You have no Apps connected yet.');
        expect(note).not.toContain('offer_app');
        expect(note).not.toContain('own computer');
        expect(note).not.toContain('reminders');
        expect(brickAbilitiesNote(base)).toContain('not available to connect yet');
    });

    it('says nothing of the Apps it has when Orbit could not say, rather than that it has none', () => {
        const note = brickAbilitiesNote({ ...base, appsKnown: false, canOffer: false, computer: true });
        expect(note).not.toContain('no Apps');
        expect(note).not.toContain('Apps you have');
        expect(note).toContain('You have your own computer.');
    });

    it('never names a vendor, a price or a limit', () => {
        const note = brickAbilitiesNote({ ...base, apps: ['Gmail'], connectable: [{ key: 'notion', name: 'Notion' }], computer: true, reminders: true, instant: true });
        expect(note).not.toMatch(/composio|agent37|\$\d|credit|\b\d+\b/i);
    });

    it('does not offer an App it has, or one they said not now to', () => {
        const apps = [
            { key: 'gmail', name: 'Gmail', blurb: '', kind: 'readyMade' as const, connectionId: 'c1', connected: true, usable: true },
            { key: 'notion', name: 'Notion', blurb: '', kind: 'listed' as const, connectionId: null, connected: false, usable: false },
            { key: 'slack', name: 'Slack', blurb: '', kind: 'listed' as const, connectionId: null, connected: false, usable: false },
        ];
        expect(offerableApps(apps, [topicOf('slack')]).map((app) => app.key)).toEqual(['notion']);
        expect(offerableApps(null, [])).toEqual([]);
    });
});

describe('The notes of a Brick no longer make it hesitate', () => {
    it('offers the Connect card straight away', () => {
        const [offer] = appToolDefinitions();
        expect(offer.function.description).toContain('Offer it straight away, in the same reply');
        // Still never one it has, never more than one, never again after "not now"
        expect(offer.function.description).toContain('at most one in a reply');
        expect(offer.function.description).toContain('If they said no to an App before, do not offer it again on your own');
    });

    it('lets it use an Instant App when it does the job better, and still never in a loop or to try it out', () => {
        const note = instantToolsNote();
        expect(note).not.toContain('answering yourself or reading a page cannot');
        expect(note).toContain('better than answering yourself or reading a page could');
        expect(note).toContain('once for a question, never in a loop, never to try it out');
    });

    it('carries on after its tools ran without stopping to ask, and says one line when something is off', () => {
        for (const inRoom of [true, false]) {
            const rules = brickFollowUpRules(inRoom);
            expect(rules).toContain('Continue this reply from the tool results above');
            expect(rules).toContain('Never hand the work back to them, and never complain about what you lack.');
            expect(rules).toContain('offer to connect an App when that is what is missing');
            expect(rules).not.toContain('Do NOT repeat location');
            expect(rules).not.toContain('Follow me!');
        }
        expect(brickFollowUpRules(false)).toContain('you are not in a room right now');
        expect(brickFollowUpRules(false)).not.toContain('you have no room');
        expect(brickFollowUpRules(true)).toContain('Invite them to come find you in your room by name');
    });
});
