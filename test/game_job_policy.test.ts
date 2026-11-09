import assert from "node:assert/strict";
import test from "node:test";
import { decideGameJob, gameJobSchema } from "../src/game_job_policy.js";

test("quarantines a rejected player asset without retrying it", () => {
  const job = gameJobSchema.parse({
    kind: "player_asset",
    jobId: "asset-job-204",
    playerId: "player-17",
    assetId: "guild-banner-8",
    scanResult: "malware",
  });

  assert.deepEqual(decideGameJob(job), {
    action: "ack",
    state: "quarantined",
    reason: "asset guild-banner-8 failed safety review",
  });
});

test("retries a live event while its feed is unavailable", () => {
  const job = gameJobSchema.parse({
    kind: "live_event",
    jobId: "event-job-88",
    playerId: "player-17",
    eventId: "raid-final-88",
    upstreamState: "unavailable",
  });

  assert.equal(decideGameJob(job).action, "nack");
});
