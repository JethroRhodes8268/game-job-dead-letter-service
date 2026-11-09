import { infrai, type QueueMessage } from "./infrai_queue.js";
import { decideGameJob, gameJobSchema, type GameJob, type JobDecision } from "./game_job_policy.js";

export async function publishGameJob(input: unknown): Promise<{ accepted: true; jobId: string }> {
  const job = gameJobSchema.parse(input);
  await infrai.queue.publish(job, `game-job-${job.jobId}`);
  return { accepted: true, jobId: job.jobId };
}

export async function handleGameMessage(message: QueueMessage): Promise<JobDecision> {
  const parsed = gameJobSchema.safeParse(message.payload);
  if (!parsed.success) {
    const decision: JobDecision = {
      action: "nack",
      state: "retry_scheduled",
      reason: "message body did not match a game job",
    };
    await infrai.queue.nack(message.message_id);
    return decision;
  }

  const decision = decideGameJob(parsed.data);
  if (decision.action === "ack") await infrai.queue.ack(message.message_id);
  else await infrai.queue.nack(message.message_id);
  return decision;
}

export async function runWorkerOnce(): Promise<Array<{ job: GameJob; decision: JobDecision }>> {
  const batch = await infrai.queue.consume(10, 45);
  const results: Array<{ job: GameJob; decision: JobDecision }> = [];
  for (const message of batch.items ?? []) {
    const parsed = gameJobSchema.safeParse(message.payload);
    const decision = await handleGameMessage(message);
    if (parsed.success) results.push({ job: parsed.data, decision });
  }
  return results;
}
