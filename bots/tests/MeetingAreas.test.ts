/**
 * A voice bot in a meeting room: which areas of a map are meeting rooms, when the bot joins and leaves their space,
 * and when it waits at the door.
 */
import { describe, expect, it } from 'vitest';
import { areaSpaceName } from '../../libs/shared-utils/src/Space/areaSpaceName';
import { MeetingPresence, isInsideMeetingArea, meetingAreasFromWam, type MeetingArea } from '../voice/MeetingAreas';

const ROOM_URL = 'http://play.example.com/@/acme/office/lobby';
const livekit = (extra: object = {}) => ({ id: 'lk-1', type: 'livekitRoomProperty', roomName: 'Board', livekitRoomConfig: {}, ...extra });
const wamArea = (id: string, properties: object[], extra: object = {}) => ({ id, name: id, x: 100, y: 100, width: 200, height: 200, visible: true, properties, ...extra });

describe('meetingAreasFromWam', () => {
    it('keeps the areas with an active LiveKit room setting, named as the game names their space', () => {
        const areas = meetingAreasFromWam({
            areas: [
                wamArea('a1', [livekit()]),
                wamArea('a2', [livekit({ id: 'lk-2', roomName: '  ' })]),
                wamArea('a3', [livekit({ disabled: true })]),
                wamArea('a4', [{ id: 'x', type: 'silent' }]),
                wamArea('a5', [livekit({ id: 'lk-5', roomName: 'Cafe' }), { id: 'm', type: 'maxUsersInAreaPropertyData', maxUsers: 3 }, { id: 'l', type: 'lockableAreaPropertyData' }]),
                wamArea('a6', [livekit()], { width: 'wide' }),
                null,
            ],
        });
        expect(areas.map((a) => [a.id, a.roomKey])).toEqual([['a1', 'Board'], ['a2', 'lk-2'], ['a5', 'Cafe']]);
        expect(areas[2]).toMatchObject({ maxUsers: { propertyId: 'm', maxUsers: 3 }, lockPropertyId: 'l' });
    });

    it('reads a map whose areas are an object, and copes with nothing at all', () => {
        expect(meetingAreasFromWam({ areas: { a1: wamArea('a1', [livekit()]) } })).toHaveLength(1);
        expect(meetingAreasFromWam({})).toEqual([]);
        expect(meetingAreasFromWam(undefined)).toEqual([]);
    });

    it('is inside when the feet are inside, like a player', () => {
        const [area] = meetingAreasFromWam({ areas: [wamArea('a1', [livekit()])] });
        expect(isInsideMeetingArea({ x: 150, y: 150 }, area)).toBe(true);
        expect(isInsideMeetingArea({ x: 150, y: 290 }, area)).toBe(false); // feet are 16 below: 306 > 300
        expect(isInsideMeetingArea({ x: 99, y: 150 }, area)).toBe(false);
    });
});

function setup(areas: MeetingArea[], options: { join?: (space: string) => Promise<boolean> } = {}) {
    let now = 0;
    const log: string[] = [];
    const presence = new MeetingPresence(
        {
            join: async (space) => {
                log.push(`join ${space}`);
                return options.join ? options.join(space) : true;
            },
            leave: async (space) => {
                log.push(`leave ${space}`);
            },
        },
        () => now
    );
    presence.setAreas(areas, ROOM_URL);
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    return {
        presence,
        log,
        /** The bot looks at its position every 200 ms for this long. */
        stand: async (position: { x: number; y: number }, ms: number) => {
            for (let t = 0; t <= ms; t += 200) {
                presence.update(position);
                now += 200;
                await settle();
            }
        },
    };
}

const board = (extra: object = {}): MeetingArea[] => meetingAreasFromWam({ areas: [wamArea('a1', [livekit(), { id: 'm', type: 'maxUsersInAreaPropertyData', maxUsers: 2 }, { id: 'l', type: 'lockableAreaPropertyData' }], extra)] });
const INSIDE = { x: 150, y: 150 };
const OUTSIDE = { x: 600, y: 600 };
const BOARD = areaSpaceName('Board', ROOM_URL);

describe('MeetingPresence', () => {
    it('joins the space of the meeting room it has stood in for a moment, and leaves it once it has been away for a moment', async () => {
        const t = setup(board());
        await t.stand(INSIDE, 1000);
        expect(t.log).toEqual([]);
        await t.stand(INSIDE, 3000);
        expect(t.log).toEqual([`join ${BOARD}`]);
        expect(t.presence.owns(BOARD)).toBe(true);
        await t.stand(OUTSIDE, 1000);
        expect(t.log).toEqual([`join ${BOARD}`]);
        await t.stand(OUTSIDE, 3000);
        expect(t.log).toEqual([`join ${BOARD}`, `leave ${BOARD}`]);
        expect(t.presence.owns(BOARD)).toBe(false);
    });

    it('does nothing for a room it only walks past', async () => {
        const t = setup(board());
        await t.stand(INSIDE, 1000);
        await t.stand(OUTSIDE, 400);
        await t.stand(INSIDE, 1000);
        await t.stand(OUTSIDE, 4000);
        expect(t.log).toEqual([]);
    });

    it('stays when it steps out for a moment, and comes back', async () => {
        const t = setup(board());
        await t.stand(INSIDE, 3000);
        await t.stand(OUTSIDE, 1000);
        await t.stand(INSIDE, 4000);
        expect(t.log).toEqual([`join ${BOARD}`]);
    });

    it('waits at the door of a locked room or a full one, and goes in when it opens', async () => {
        const t = setup(board());
        t.presence.setLive('a1', 'l', 'lock', 'true');
        await t.stand(INSIDE, 4000);
        expect(t.log).toEqual([]);
        t.presence.setLive('a1', 'l', 'lock', 'false');
        t.presence.setLive('a1', 'm', 'usersInside', '2');
        await t.stand(INSIDE, 4000);
        expect(t.log).toEqual([]);
        t.presence.setLive('a1', 'm', 'usersInside', '1');
        await t.stand(INSIDE, 4000);
        expect(t.log).toEqual([`join ${BOARD}`]);
    });

    it('does not leave a room that fills or locks while it is inside', async () => {
        const t = setup(board());
        await t.stand(INSIDE, 3000);
        t.presence.setLive('a1', 'l', 'lock', 'true');
        t.presence.setLive('a1', 'm', 'usersInside', '5');
        await t.stand(INSIDE, 4000);
        expect(t.log).toEqual([`join ${BOARD}`]);
    });

    it('does not keep knocking at a room the game refused', async () => {
        const t = setup(board(), { join: async () => false });
        await t.stand(INSIDE, 10000);
        expect(t.log).toEqual([`join ${BOARD}`]);
        expect(t.presence.owns(BOARD)).toBe(false);
        // Tried again after a long while
        await t.stand(INSIDE, 40000);
        expect(t.log.length).toBeGreaterThan(1);
    });

    it('is left alone by the game taking it out of the room, and tries again later', async () => {
        const t = setup(board());
        await t.stand(INSIDE, 3000);
        t.presence.spaceLeft(BOARD);
        await t.stand(INSIDE, 10000);
        expect(t.log).toEqual([`join ${BOARD}`]);
        await t.stand(INSIDE, 40000);
        expect(t.log).toEqual([`join ${BOARD}`, `join ${BOARD}`]);
    });

    it('does nothing on a map with no meeting rooms', async () => {
        const t = setup([]);
        await t.stand(INSIDE, 5000);
        expect(t.log).toEqual([]);
    });
});
