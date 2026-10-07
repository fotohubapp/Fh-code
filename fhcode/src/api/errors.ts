/**
 * Errors raised by the FOTOhub API client.
 *
 * The API puts rich error bodies inside `detail` (see docs.fotohub.app/api/errors),
 * and a plain failure is just `{"detail": "..."}`, so both shapes are handled.
 */

export class FotohubApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly body: unknown;

  constructor(message: string, status: number, code: string, requestId?: string, body?: unknown) {
    super(message);
    this.name = "FotohubApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.body = body;
  }
}

/** HTTP 402: the prepaid wallet cannot cover the request. Nothing was charged. */
export class InsufficientFundsError extends FotohubApiError {
  readonly requiredUsd: number | undefined;
  readonly balanceUsd: number | undefined;
  readonly topupUrl: string | undefined;

  constructor(message: string, requestId: string | undefined, detail: Record<string, unknown>) {
    super(message, 402, "insufficient_funds", requestId, detail);
    this.name = "InsufficientFundsError";
    this.requiredUsd = numberOrUndefined(detail.required_usd);
    this.balanceUsd = numberOrUndefined(detail.balance_usd);
    this.topupUrl = typeof detail.topup_url === "string" ? detail.topup_url : undefined;
  }
}

/** HTTP 429: the account's tier rate limit (requests per minute) was hit. */
export class RateLimitError extends FotohubApiError {
  readonly retryAfterSeconds: number | undefined;

  constructor(message: string, requestId: string | undefined, retryAfterSeconds: number | undefined, body: unknown) {
    super(message, 429, "rate_limited", requestId, body);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function errorFromResponse(res: Response): Promise<FotohubApiError> {
  const requestId = res.headers.get("x-request-id") ?? undefined;
  const text = await res.text().catch(() => "");
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    // Not JSON; keep the raw text.
  }

  const detail = body && typeof body === "object" ? (body as Record<string, unknown>).detail : undefined;
  const top = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const detailObj = detail && typeof detail === "object" ? (detail as Record<string, unknown>) : undefined;

  const message =
    (detailObj && typeof detailObj.message === "string" && detailObj.message) ||
    (typeof detail === "string" && detail) ||
    (typeof top.message === "string" && top.message) ||
    (typeof top.error === "string" && top.error) ||
    text ||
    `HTTP ${res.status}`;
  const code =
    (detailObj && typeof detailObj.error === "string" && detailObj.error) ||
    (typeof top.error === "string" && /^[a-z_]+$/.test(top.error) ? top.error : "") ||
    `http_${res.status}`;

  if (res.status === 402) {
    return new InsufficientFundsError(message, requestId, detailObj ?? {});
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after"));
    return new RateLimitError(message, requestId, Number.isFinite(retryAfter) ? retryAfter : undefined, body);
  }
  return new FotohubApiError(message, res.status, code, requestId, body);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
