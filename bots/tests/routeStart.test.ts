/**
 * Tests for where a route bot goes when the bot editor asks it to start its route again (Done after editing the
 * route): onto stop 1, to walk the route from the beginning.
 */
import { describe, expect, it } from "vitest";
import { routeStart } from "../server/BotManager";

const route = { moves: "route" as const, goesToPeople: false };
const stops = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 300 },
];

describe("routeStart", () => {
  it("is stop 1 of a route", () => {
    expect(
      routeStart(route, { moves: "route", patrolWaypoints: stops })
    ).toEqual({ x: 100, y: 100 });
  });

  it("reads the older waypoints key too", () => {
    expect(
      routeStart(route, { moves: "route", waypoints: stops.slice(1) })
    ).toEqual({ x: 300, y: 100 });
  });

  it("is nothing for a bot that doesn't walk a route, or a route with no stops", () => {
    expect(
      routeStart(
        { moves: "wander", goesToPeople: false },
        { patrolWaypoints: stops }
      )
    ).toBeUndefined();
    expect(
      routeStart(
        { moves: "stay", goesToPeople: true },
        { patrolWaypoints: stops }
      )
    ).toBeUndefined();
    expect(
      routeStart(route, { moves: "route", patrolWaypoints: [] })
    ).toBeUndefined();
    expect(routeStart(route, undefined)).toBeUndefined();
  });
});
