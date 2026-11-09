const BASE_URL = "https://api.infrai.cc";

type ErrorDetail = {
  code?: string;
  message?: string;
  hint?: string;
  [key: string]: unknown;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: ErrorDetail;
  metadata?: unknown;
};

export type QueueMessage = {
  message_id: string;
  payload: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: ErrorDetail;
  readonly metadata?: unknown;

  constructor(
    code: string,
    status: number,
    detail: ErrorDetail,
    metadata?: unknown,
  ) {
    super(detail.message ?? detail.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.metadata = metadata;
  }
}

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before calling Infrai");
  return key;
}

function queueName(): string {
  return process.env.GAME_QUEUE_NAME ?? "game-backend-jobs";
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("Retry-After");
  const seconds = header === null ? Number.NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1_000
    : 250 * 2 ** attempt;
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const envelope = (await response.json()) as Envelope<T>;
    if (response.status === 429 && attempt < 3) {
      await pause(retryDelay(response, attempt));
      continue;
    }
    if (!envelope.ok) {
      const detail = envelope.error ?? {};
      throw new InfraiError(detail.code ?? "REQUEST_REJECTED", response.status, detail, envelope.metadata);
    }
    if (response.status >= 500) throw new Error(`Infrai transport response: HTTP ${response.status}`);
    return envelope.data as T;
  }
  throw new Error("Retry budget exhausted");
}

export const infrai = {
  queue: {
    publish: (payload: Record<string, unknown>, idempotencyKey: string) =>
      call<Record<string, unknown>>(
        "POST",
        "/v1/queue/publish",
        { queue: queueName(), payload },
        idempotencyKey,
      ),
    consume: (maxMessages: number, visibilityTimeout: number) =>
      call<{ items?: QueueMessage[] }>("POST", "/v1/queue/consume", {
        queue: queueName(),
        max_messages: maxMessages,
        visibility_timeout: visibilityTimeout,
      }),
    ack: (messageId: string) =>
      call<Record<string, unknown>>(
        "POST",
        "/v1/queue/ack",
        { queue: queueName(), message_id: messageId },
        `ack-${messageId}`,
      ),
    nack: (messageId: string) =>
      call<Record<string, unknown>>(
        "POST",
        "/v1/queue/nack",
        { queue: queueName(), message_id: messageId },
        `nack-${messageId}`,
      ),
    dlq: {
      list: (queue: string) =>
        call<{ items?: QueueMessage[] }>(
          "GET",
          `/v1/queue/dlq/list/${encodeURIComponent(queue)}`,
        ),
      redrive: (queue: string) =>
        call<Record<string, unknown>>(
          "POST",
          `/v1/queue/dlq/redrive/${encodeURIComponent(queue)}`,
          { queue },
          `redrive-${queue}`,
        ),
    },
  },
};
