import { z } from "zod";

const common = {
  jobId: z.string().min(1),
  playerId: z.string().min(1),
};

export const gameJobSchema = z.discriminatedUnion("kind", [
  z.object({
    ...common,
    kind: z.literal("player_asset"),
    assetId: z.string().min(1),
    scanResult: z.enum(["clean", "malware"]),
  }),
  z.object({
    ...common,
    kind: z.literal("live_event"),
    eventId: z.string().min(1),
    upstreamState: z.enum(["ready", "unavailable"]),
  }),
  z.object({
    ...common,
    kind: z.literal("moderation_queue"),
    reportId: z.string().min(1),
    verdict: z.enum(["approved", "rejected", "pending"]),
  }),
]);

export type GameJob = z.infer<typeof gameJobSchema>;
export type JobDecision =
  | { action: "ack"; state: "completed" | "quarantined"; reason: string }
  | { action: "nack"; state: "retry_scheduled"; reason: string };

export function decideGameJob(job: GameJob): JobDecision {
  if (job.kind === "player_asset") {
    return job.scanResult === "malware"
      ? { action: "ack", state: "quarantined", reason: `asset ${job.assetId} failed safety review` }
      : { action: "ack", state: "completed", reason: `asset ${job.assetId} is ready` };
  }

  if (job.kind === "live_event") {
    return job.upstreamState === "unavailable"
      ? { action: "nack", state: "retry_scheduled", reason: `event ${job.eventId} is waiting for its feed` }
      : { action: "ack", state: "completed", reason: `event ${job.eventId} is live` };
  }

  if (job.verdict === "pending") {
    return { action: "nack", state: "retry_scheduled", reason: `report ${job.reportId} still needs a verdict` };
  }
  return {
    action: "ack",
    state: job.verdict === "rejected" ? "quarantined" : "completed",
    reason: `report ${job.reportId} resolved as ${job.verdict}`,
  };
}
