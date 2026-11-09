import { createServer, type ServerResponse } from "node:http";
import { z } from "zod";
import { InfraiError, infrai } from "./infrai_queue.js";
import { publishGameJob, runWorkerOnce } from "./game_queue_worker.js";

const queueName = process.env.GAME_QUEUE_NAME ?? "game-backend-jobs";

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serve(): Promise<void> {
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/jobs") {
      send(response, 404, { error: "route_not_found" });
      return;
    }
    try {
      send(response, 202, await publishGameJob(await readJson(request)));
    } catch (error) {
      if (error instanceof z.ZodError) {
        send(response, 400, { error: "invalid_game_job", issues: error.issues });
        return;
      }
      if (error instanceof InfraiError) {
        const status = error.status >= 400 && error.status < 500 ? error.status : 502;
        send(response, status, { error: error.code, message: error.message });
        return;
      }
      send(response, 500, { error: "request_failed" });
    }
  });
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`game job service listening on http://localhost:${port}`));
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "serve";
  if (command === "serve") return serve();
  if (command === "worker") {
    console.log(JSON.stringify(await runWorkerOnce(), null, 2));
    return;
  }
  if (command === "dlq") {
    console.log(JSON.stringify((await infrai.queue.dlq.list(queueName)).items ?? [], null, 2));
    return;
  }
  if (command === "redrive") {
    await infrai.queue.dlq.redrive(queueName);
    console.log(JSON.stringify({ queue: queueName, state: "redrive_requested" }));
    return;
  }
  throw new Error("Use serve, worker, dlq, or redrive");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
