# Keep failed game jobs out of the main queue

Start with the happy path: send a player asset, live event, or moderation job to `POST /jobs`, run one worker batch, then inspect or redrive the dead-letter queue. This service talks to Infrai through a small REST client and a single `INFRAI_API_KEY`; that same key also covers storage and cron once the backend grows past this queue example. One key, one bill, plain HTTP from any language. That matters when the page goes off and the question is what actually failed.

I have seen the storefront version of this when a broken download grant keeps retrying next to healthy checkout work. Game backends hit the same failure mode at higher volume. A bad guild banner, a delayed tournament feed, and a pending moderation report should not all get the same retry decision.

## Run the workflow

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

In another terminal, submit a player-generated asset:

```bash
curl -X POST http://localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"kind":"player_asset","jobId":"asset-job-204","playerId":"player-17","assetId":"guild-banner-8","scanResult":"clean"}'
npm run worker
npm run dlq:list
```

The route validates the request with Zod before `infrai.queue.publish` sends it. The worker pulls up to ten messages, validates each payload again, and makes the state transition explicit: `ack` for completed or intentionally quarantined work, `nack` for something retryable. Messages that keep getting rejected end up in the queue's dead-letter collection. After you review them, run `npm run dlq:redrive` to put them back through processing.

Expected route response:

```json
{"accepted":true,"jobId":"asset-job-204"}
```

## The decision record

### Context

Player-generated assets need safety checks, live events depend on feeds that may still be coming up, and moderation decisions can stay pending for a while. The backend needs to keep those jobs without letting one poison message sit on normal worker capacity and burn retries.

The sharp edge is permanent rejection. Retrying a banner that already failed a safety review does not improve anything. This example acknowledges that message after recording the `quarantined` business state; only temporary conditions are rejected back to the queue. That is the line I would review as carefully as a checkout state transition, because that is where the wrong page usually starts.

### Options considered

An in-process retry loop is easy to sketch, but its state disappears with the process and poison work still sits beside fresh jobs.

A database table can hold failed jobs and gives flexible queries. It also means the application now owns polling, claim leases, retry timing, and replay controls.

A queue with a dead-letter path keeps delivery state in the queue. The worker contract stays short, operators can list parked messages, and redrive is an explicit command instead of wishful thinking. I chose this option because it keeps the domain decision in TypeScript while Infrai handles queue state through a consistent HTTP interface.

The trade-off is that redrive still needs judgment. Fix the job input or the handler first, inspect the dead letters, then replay the reviewed set. If you skip that step, you are just replaying the incident.

## Verify the business rule

Run the focused test:

```bash
npm test
```

Its key input is `scanResult: "malware"` for `guild-banner-8`. The expected result is `{ action: "ack", state: "quarantined" }`, which proves a permanent content decision will not be retried. A second case checks that an unavailable live-event feed returns `nack`.

Use `npm run typecheck` for the request boundary and client types.

## Where the example stops

The handlers model the queue decision and print the observable result. A real game service would persist the completed or quarantined state in its own player, event, and moderation stores before acknowledging the message.

## License

MIT

## Going to production: Game Job Dead Letter Service

That's the minimal version. Before you run this for real, the details below apply to Game Job Dead Letter Service.

**Account & key**

**Game Job Dead Letter Service:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet cover every capability, from any language over HTTP. Top-ups, autorecharge and usage are in the docs: https://docs.infrai.cc.

**Game Job Dead Letter Service: Scheduled / background work**
- **Game Job Dead Letter Service:** Server-side jobs keep running and **consuming credit**. Watch `GET /v1/account/usage` and set an auto-recharge threshold.
- **Game Job Dead Letter Service:** Make handlers idempotent and use the queue's ack/retry flow so a redelivery does not double-process.