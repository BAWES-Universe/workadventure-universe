# Remove Improvements Endpoints

## Summary

The `/api/bots/improvements` endpoints are no longer needed and should be removed. They were logging test failures but not actually tracking improvements effectively. Task files in `bots/improvement-tasks/` are now the source of truth.

## Endpoints to REMOVE

- `POST /api/bots/improvements` - Save improvement record
- `GET /api/bots/improvements` - List improvements  
- `GET /api/bots/improvements/:id` - Get improvement details
- `PATCH /api/bots/improvements/:id` - Update improvement (deployed status)

## Database Table to REMOVE

- `bots_improvements` table (can be dropped, data is not useful)

## Why Remove?

1. **No feedback loop**: The improvements table was just logging failures with `deployed: false`, but there was no mechanism to mark things as "deployed" or verify fixes worked.

2. **Task files are source of truth**: The new system uses task files in `bots/improvement-tasks/` with status tracking (`pending`, `in_progress`, `resolved`, `failed`). These files are:
   - Created when tests fail
   - Updated when AI fixes code
   - Automatically verified on next test cycle
   - Deleted when resolved

3. **Creates confusion**: The improvements table showed "3 improvements" but they were just test failure logs, not actual improvements. This was misleading.

4. **No value**: The data in the improvements table doesn't help with the improvement workflow - task files contain all the necessary information.

## What to Keep

These endpoints are still needed and should remain:

- ✅ `POST /api/bots/metrics` - Metrics collection
- ✅ `GET /api/bots/metrics` - Query metrics
- ✅ `POST /api/bots/conversations` - Conversation storage
- ✅ `GET /api/bots/conversations` - Query conversations
- ✅ `POST /api/bots/memory/:botId` - Memory storage
- ✅ `GET /api/bots/memory/:botId` - Get memory
- ✅ `POST /api/bots/test-results` - Test results storage
- ✅ `GET /api/bots/test-results` - Query test results

## Migration Notes

- The bot server no longer calls `saveImprovement()` - this method has been removed from `AdminApiService.ts`
- Any existing data in `bots_improvements` can be safely deleted
- No migration needed - just drop the table and remove the endpoints

## New Workflow

Instead of the improvements table, the system now works like this:

1. AutoPilot runs tests every 30 seconds
2. If tests fail → creates task file with `status: "pending"`
3. AI analyzes task → fixes code → updates task to `status: "in_progress"`
4. Next test cycle → if tests pass, marks task as `status: "resolved"`
5. Resolved tasks auto-deleted after 5 minutes

This provides a clear feedback loop and actual tracking of improvements.
