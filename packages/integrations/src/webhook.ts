import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { BadRequestError } from "@brightloop/shared";

export const SIGNATURE_HEADER = "x-brightloop-signature";
export const TIMESTAMP_HEADER = "x-brightloop-timestamp";
export const DELIVERY_HEADER = "x-brightloop-delivery";
export const EVENT_HEADER = "x-brightloop-event";

export function signWebhook(secret: string, timestamp: string, body: string): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `sha256=${digest}`;
}

export function verifyWebhook(secret: string, timestamp: string, body: string, signature: string): boolean {
  const expected = signWebhook(secret, timestamp, body);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80") ||
    normalized === "::"
  );
}

export async function validateWebhookUrl(rawUrl: string, allowLocal = false): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestError("webhook url must be a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BadRequestError("webhook url must use http or https");
  }
  const hostname = url.hostname.toLowerCase();
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (local) {
    if (!allowLocal) throw new BadRequestError("webhook url must point to a public host");
    return;
  }
  const addresses: string[] = [];
  if (isIP(hostname)) {
    addresses.push(hostname);
  } else {
    try {
      const resolved = await lookup(hostname, { all: true });
      addresses.push(...resolved.map((entry) => entry.address));
    } catch {
      throw new BadRequestError("webhook host could not be resolved");
    }
  }
  for (const address of addresses) {
    const version = isIP(address);
    if (version === 4 && isPrivateIpv4(address)) throw new BadRequestError("webhook url must not target a private address");
    if (version === 6 && isPrivateIpv6(address)) throw new BadRequestError("webhook url must not target a private address");
  }
}

export interface DeliveryResult {
  ok: boolean;
  status: number | null;
  retryable: boolean;
  error: string | null;
}

export async function deliverWebhook(input: {
  url: string;
  secret: string;
  eventType: string;
  deliveryId: string;
  payload: unknown;
  timeoutMs: number;
  allowLocal?: boolean;
}): Promise<DeliveryResult> {
  const body = JSON.stringify(input.payload);
  if (Buffer.byteLength(body) > 256 * 1024) {
    return { ok: false, status: null, retryable: false, error: "payload exceeds 256 KB" };
  }
  try {
    await validateWebhookUrl(input.url, input.allowLocal);
  } catch (error) {
    return { ok: false, status: null, retryable: false, error: (error as Error).message };
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signWebhook(input.secret, timestamp, body);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [EVENT_HEADER]: input.eventType,
        [DELIVERY_HEADER]: input.deliveryId,
        [TIMESTAMP_HEADER]: timestamp,
        [SIGNATURE_HEADER]: signature,
      },
      body,
      signal: controller.signal,
    });
    const ok = response.status >= 200 && response.status < 300;
    const retryable = response.status === 429 || response.status >= 500;
    return {
      ok,
      status: response.status,
      retryable,
      error: ok ? null : `receiver returned ${response.status}`,
    };
  } catch (error) {
    return { ok: false, status: null, retryable: true, error: (error as Error).message };
  } finally {
    clearTimeout(timeout);
  }
}

export function backoffSeconds(attempt: number): number {
  const schedule = [1, 5, 30, 120, 600];
  return schedule[Math.min(attempt, schedule.length - 1)] ?? 600;
}
