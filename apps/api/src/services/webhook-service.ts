import { randomBytes } from "node:crypto";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  type TenantContext,
} from "@brightloop/shared";
import {
  DeadLetterEvent,
  OutboxEvent,
  Webhook,
  WebhookDelivery,
} from "@brightloop/db";
import {
  backoffSeconds,
  decryptSecret,
  deliverWebhook,
  encryptSecret,
  validateWebhookUrl,
} from "@brightloop/integrations";
import type { AppConfig } from "../config/env.js";

export async function createWebhook(ctx: TenantContext, config: AppConfig, input: any) {
  await validateWebhookUrl(input.url, config.ALLOW_LOCAL_WEBHOOKS);
  const secret = input.secret ?? `whsec_${randomBytes(24).toString("base64url")}`;
  const webhook = await Webhook.create({
    tenantId: ctx.tenantId,
    url: input.url,
    secretCipher: encryptSecret(secret, config.JWT_SECRET),
    events: input.events,
    enabled: input.enabled,
  });
  return { webhook, secret };
}

export async function updateWebhook(ctx: TenantContext, config: AppConfig, id: string, input: any) {
  const webhook = await Webhook.findOne({ _id: id, tenantId: ctx.tenantId });
  if (!webhook) throw new NotFoundError("Webhook");
  if (input.url) {
    await validateWebhookUrl(input.url, config.ALLOW_LOCAL_WEBHOOKS);
    webhook.url = input.url;
  }
  if (input.events) webhook.events = input.events;
  if (input.enabled !== undefined) webhook.enabled = input.enabled;
  await webhook.save();
  return webhook;
}

export async function deleteWebhook(ctx: TenantContext, id: string) {
  const webhook = await Webhook.findOne({ _id: id, tenantId: ctx.tenantId });
  if (!webhook) throw new NotFoundError("Webhook");
  await Webhook.deleteOne({ _id: id, tenantId: ctx.tenantId });
}

export async function listWebhooks(tenantId: string) {
  return Webhook.find({ tenantId }).sort({ createdAt: -1 });
}

export async function listDeliveries(tenantId: string, webhookId: string, page: number, perPage: number) {
  const webhook = await Webhook.findOne({ _id: webhookId, tenantId });
  if (!webhook) throw new NotFoundError("Webhook");
  const [data, total] = await Promise.all([
    WebhookDelivery.find({ tenantId, webhookId })
      .sort({ createdAt: -1 })
      .skip(page * perPage)
      .limit(perPage),
    WebhookDelivery.countDocuments({ tenantId, webhookId }),
  ]);
  return { data, total };
}

export async function dispatchOutbox(config: AppConfig, limit = 50) {
  let dispatched = 0;
  for (let index = 0; index < limit; index += 1) {
    const event = await OutboxEvent.findOneAndUpdate(
      {
        status: "PENDING",
        availableAt: { $lte: new Date() },
        $or: [{ lockedUntil: null }, { lockedUntil: { $lt: new Date() } }],
      },
      { $set: { lockedUntil: new Date(Date.now() + 60_000) }, $inc: { attempts: 1 } },
      { new: true, sort: { createdAt: 1 } },
    );
    if (!event) break;
    try {
      const webhooks = await Webhook.find({
        tenantId: event.tenantId,
        enabled: true,
        events: event.type,
      });
      for (const webhook of webhooks) {
        await WebhookDelivery.create({
          tenantId: event.tenantId,
          webhookId: String(webhook._id),
          eventType: event.type,
          payload: event.payload,
          status: "PENDING",
          attempts: 0,
          nextAttemptAt: new Date(),
        });
      }
      event.status = "PROCESSED";
      event.processedAt = new Date();
      event.lockedUntil = null;
      event.error = null;
      await event.save();
      dispatched += 1;
    } catch (error) {
      event.status = event.attempts >= 5 ? "FAILED" : "PENDING";
      event.error = (error as Error).message;
      event.availableAt = new Date(Date.now() + backoffSeconds(event.attempts) * 1000);
      event.lockedUntil = null;
      await event.save();
      if (event.status === "FAILED") {
        await DeadLetterEvent.create({
          tenantId: event.tenantId,
          source: "outbox",
          payload: { eventId: String(event._id), type: event.type },
          error: event.error,
        });
      }
    }
  }
  return dispatched;
}

export async function processWebhookDeliveries(config: AppConfig, limit = 50) {
  let processed = 0;
  for (let index = 0; index < limit; index += 1) {
    const delivery = await WebhookDelivery.findOneAndUpdate(
      { status: "PENDING", nextAttemptAt: { $lte: new Date() } },
      { $inc: { attempts: 1 } },
      { new: true, sort: { nextAttemptAt: 1 } },
    );
    if (!delivery) break;
    const webhook = await Webhook.findOne({ _id: delivery.webhookId, tenantId: delivery.tenantId });
    if (!webhook || !webhook.enabled) {
      delivery.status = "FAILED";
      delivery.lastError = "webhook is missing or disabled";
      await delivery.save();
      processed += 1;
      continue;
    }
    const secret = decryptSecret(webhook.secretCipher, config.JWT_SECRET);
    const result = await deliverWebhook({
      url: webhook.url,
      secret,
      eventType: delivery.eventType,
      deliveryId: String(delivery._id),
      payload: delivery.payload,
      timeoutMs: config.WEBHOOK_TIMEOUT_MS,
      allowLocal: config.ALLOW_LOCAL_WEBHOOKS,
    });
    delivery.responseStatus = result.status;
    delivery.lastError = result.error;
    if (result.ok) {
      delivery.status = "DELIVERED";
      delivery.nextAttemptAt = null;
    } else if (result.retryable && delivery.attempts < config.WEBHOOK_MAX_ATTEMPTS) {
      delivery.status = "PENDING";
      delivery.nextAttemptAt = new Date(Date.now() + backoffSeconds(delivery.attempts) * 1000);
    } else {
      delivery.status = "FAILED";
      delivery.nextAttemptAt = null;
      await DeadLetterEvent.create({
        tenantId: delivery.tenantId,
        source: "webhook",
        payload: {
          deliveryId: String(delivery._id),
          webhookId: delivery.webhookId,
          eventType: delivery.eventType,
        },
        error: result.error ?? "delivery failed",
      });
    }
    await delivery.save();
    processed += 1;
  }
  return processed;
}

export async function replayDeadLetter(ctx: TenantContext, id: string) {
  const deadLetter = await DeadLetterEvent.findOne({ _id: id, tenantId: ctx.tenantId });
  if (!deadLetter) throw new NotFoundError("Dead letter event");
  if (deadLetter.source !== "webhook") throw new BadRequestError("Only webhook dead letters can be replayed");
  const payload = deadLetter.payload as any;
  const delivery = await WebhookDelivery.findOne({ _id: payload.deliveryId, tenantId: ctx.tenantId });
  if (!delivery) throw new NotFoundError("Delivery");
  delivery.status = "PENDING";
  delivery.attempts = 0;
  delivery.nextAttemptAt = new Date();
  await delivery.save();
  return delivery;
}

export async function webhookDeliveriesForTenant(tenantId: string, page: number, perPage: number) {
  const [data, total] = await Promise.all([
    WebhookDelivery.find({ tenantId })
      .sort({ createdAt: -1 })
      .skip(page * perPage)
      .limit(perPage),
    WebhookDelivery.countDocuments({ tenantId }),
  ]);
  return { data, total };
}

void ForbiddenError;
