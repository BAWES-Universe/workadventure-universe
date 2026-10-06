/**
 * Tests for where a route bot goes when the bot editor changes its route: onto stop 1, to walk the new route from
 * the beginning.
 */
import { describe, expect, it } from "vitest";
import { routeStartAfterEdit } from "../server/BotManager";

const route = { moves: "route" as const, goesToPeople: false };
const stops = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 300 },
];

describe("routeStartAfterEdit", () => {
  it("puts the bot on stop 1 when a stop was added, moved or removed", () => {
    const before = { moves: "route", patrolWaypoints: stops.slice(0, 2) };
    expect(
      routeStartAfterEdit("patrol", before, route, {
        moves: "route",
        patrolWaypoints: stops,
      })
    ).toEqual({
      x: 100,
      y: 100,
    });
    const moved = [{ x: 150, y: 120 }, ...stops.slice(1)];
    expect(
      routeStartAfterEdit(
        "patrol",
        { moves: "route", patrolWaypoints: stops },
        route,
        { moves: "route", patrolWaypoints: moved }
      )
    ).toEqual({
      x: 150,
      y: 120,
    });
  });

  it("puts the bot on stop 1 when it starts walking a route", () => {
    const before = { moves: "wander", patrolWaypoints: stops };
    expect(
      routeStartAfterEdit("social", before, route, {
        moves: "route",
        patrolWaypoints: stops,
      })
    ).toEqual({
      x: 100,
      y: 100,
    });
  });

  it("reads stops saved under the older key", () => {
    expect(
      routeStartAfterEdit("patrol", {}, route, { waypoints: stops })
    ).toEqual({ x: 100, y: 100 });
  });

  it("leaves the bot where it is when a save repeats the same route", () => {
    const cfg = { moves: "route", patrolWaypoints: stops };
    expect(
      routeStartAfterEdit("patrol", cfg, route, {
        ...cfg,
        conversationRadius: 80,
      })
    ).toBeUndefined();
  });

  it("leaves bots that do not walk a route, and empty routes, alone", () => {
    expect(
      routeStartAfterEdit(
        "patrol",
        {},
        { moves: "wander", goesToPeople: true },
        { patrolWaypoints: stops }
      )
    ).toBeUndefined();
    expect(
      routeStartAfterEdit("idle", {}, route, {
        moves: "route",
        patrolWaypoints: [],
      })
    ).toBeUndefined();
  });
});
