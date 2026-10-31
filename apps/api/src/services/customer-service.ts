import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  type TenantContext,
} from "@brightloop/shared";
import { Customer, InvoicingEntity, Subscription } from "@brightloop/db";
import { defaultInvoicingEntity, emitEvent, recordActivity } from "../lib/domain.js";
import { escapeRegex } from "../lib/http.js";

function inputToCustomer(input: any) {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.invoicing_emails !== undefined ? { invoicingEmails: input.invoicing_emails } : {}),
    ...(input.billing_email !== undefined ? { billingEmail: input.billing_email } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.vat_number !== undefined ? { vatNumber: input.vat_number } : {}),
    ...(input.currency !== undefined ? { currency: input.currency } : {}),
    ...(input.invoicing_entity_id !== undefined ? { invoicingEntityId: input.invoicing_entity_id } : {}),
    ...(input.billing_address !== undefined ? { billingAddress: input.billing_address } : {}),
    ...(input.shipping_address !== undefined ? { shippingAddress: input.shipping_address } : {}),
    ...(input.custom_taxes !== undefined ? { customTaxes: input.custom_taxes } : {}),
    ...(input.is_tax_exempt !== undefined ? { isTaxExempt: input.is_tax_exempt } : {}),
    ...(input.exemption_reason !== undefined ? { exemptionReason: input.exemption_reason } : {}),
  };
}

export async function createCustomer(ctx: TenantContext, input: any) {
  const existing = await Customer.findOne({ tenantId: ctx.tenantId, alias: input.alias });
  if (existing) throw new ConflictError("Customer alias is already in use");
  const entity = input.invoicing_entity_id
    ? await InvoicingEntity.findOne({ _id: input.invoicing_entity_id, tenantId: ctx.tenantId })
    : await defaultInvoicingEntity(ctx.tenantId);
  if (!entity) throw new BadRequestError("An invoicing entity is required");
  const customer = await Customer.create({
    tenantId: ctx.tenantId,
    alias: input.alias,
    ...inputToCustomer(input),
    invoicingEntityId: String(entity._id),
  });
  await emitEvent(ctx, "customer.created", { customerId: String(customer._id), alias: customer.alias, name: customer.name });
  await recordActivity({
    tenantId: ctx.tenantId,
    entityType: "customer",
    entityId: String(customer._id),
    action: "created",
    actorId: ctx.actorId,
    diff: { alias: customer.alias, name: customer.name },
  });
  return customer;
}

export async function updateCustomer(ctx: TenantContext, customerId: string, input: any) {
  const customer = await Customer.findOne({ _id: customerId, tenantId: ctx.tenantId });
  if (!customer) throw new NotFoundError("Customer");
  if (customer.archivedAt) throw new ConflictError("Archived customers cannot be updated");
  if (input.invoicing_entity_id) {
    const entity = await InvoicingEntity.findOne({ _id: input.invoicing_entity_id, tenantId: ctx.tenantId });
    if (!entity) throw new BadRequestError("invoicing_entity_id does not belong to this tenant");
  }
  Object.assign(customer, inputToCustomer(input), { updatedAt: new Date() });
  await customer.save();
  await emitEvent(ctx, "customer.updated", { customerId, fields: Object.keys(input) });
  await recordActivity({
    tenantId: ctx.tenantId,
    entityType: "customer",
    entityId: customerId,
    action: "updated",
    actorId: ctx.actorId,
    diff: input,
  });
  return customer;
}

export async function archiveCustomer(ctx: TenantContext, customerId: string) {
  const customer = await Customer.findOne({ _id: customerId, tenantId: ctx.tenantId });
  if (!customer) throw new NotFoundError("Customer");
  if (customer.archivedAt) return customer;
  const active = await Subscription.findOne({
    tenantId: ctx.tenantId,
    customerId,
    status: { $in: ["ACTIVE", "TRIAL_ACTIVE", "PENDING_ACTIVATION", "PAUSED"] },
  });
  if (active) throw new ConflictError("Cancel active subscriptions before archiving this customer");
  customer.archivedAt = new Date();
  customer.updatedAt = new Date();
  await customer.save();
  await emitEvent(ctx, "customer.archived", { customerId });
  await recordActivity({
    tenantId: ctx.tenantId,
    entityType: "customer",
    entityId: customerId,
    action: "archived",
    actorId: ctx.actorId,
  });
  return customer;
}

export async function listCustomers(
  tenantId: string,
  query: { page: number; per_page: number; search?: string; archived: boolean; order_by?: string },
) {
  const filter: Record<string, unknown> = {
    tenantId,
    archivedAt: query.archived ? { $ne: null } : null,
  };
  if (query.search) {
    const regex = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: regex }, { alias: regex }, { invoicingEmails: regex }, { billingEmail: regex }];
  }
  const sort = query.order_by
    ? { [query.order_by.split(".")[0]!]: query.order_by.endsWith(".asc") ? 1 : -1 }
    : { createdAt: -1 };
  const [data, total] = await Promise.all([
    Customer.find(filter)
      .sort(sort as any)
      .skip(query.page * query.per_page)
      .limit(query.per_page),
    Customer.countDocuments(filter),
  ]);
  return { data, total };
}

export async function getCustomer(tenantId: string, idOrAlias: string) {
  const customer = await Customer.findOne({
    tenantId,
    $or: [{ _id: idOrAlias }, { alias: idOrAlias }],
  });
  if (!customer) throw new NotFoundError("Customer");
  return customer;
}

export async function customerOverview(tenantId: string, customerId: string) {
  const customer = await getCustomer(tenantId, customerId);
  const subscriptions = await Subscription.find({ tenantId, customerId }).sort({ createdAt: -1 });
  return { customer, subscriptions };
}
