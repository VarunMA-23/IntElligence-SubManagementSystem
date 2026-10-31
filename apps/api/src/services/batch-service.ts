import { NotFoundError, type TenantContext } from "@brightloop/shared";
import { BatchJob, BatchJobItem } from "@brightloop/db";
import { createCustomer } from "./customer-service.js";
import { generateInvoices } from "./invoice-service.js";

export async function createBatchJob(ctx: TenantContext, input: { type: string; items: any[] }) {
  const job = await BatchJob.create({
    tenantId: ctx.tenantId,
    type: input.type,
    status: "RUNNING",
    total: input.items.length,
    processed: 0,
    failed: 0,
    createdBy: ctx.actorId,
  });
  let processed = 0;
  let failed = 0;
  for (let index = 0; index < input.items.length; index += 1) {
    const item = await BatchJobItem.create({
      tenantId: ctx.tenantId,
      batchJobId: String(job._id),
      index,
      input: input.items[index],
      status: "RUNNING",
    });
    try {
      if (input.type === "customer.import") {
        await createCustomer(ctx, input.items[index]);
      } else if (input.type === "invoice.generate") {
        await generateInvoices(ctx, input.items[index]);
      }
      item.status = "COMPLETED";
      processed += 1;
    } catch (error) {
      item.status = "FAILED";
      item.error = error instanceof Error ? error.message : "unknown error";
      failed += 1;
    }
    await item.save();
    job.processed = processed;
    job.failed = failed;
    await job.save();
  }
  job.status = failed === 0 ? "COMPLETED" : processed === 0 ? "FAILED" : "PARTIAL";
  await job.save();
  return job;
}

export async function listBatchJobs(
  tenantId: string,
  query: { page: number; per_page: number; status?: string; type?: string },
) {
  const filter: Record<string, unknown> = { tenantId };
  if (query.status) filter.status = query.status;
  if (query.type) filter.type = query.type;
  const [data, total] = await Promise.all([
    BatchJob.find(filter)
      .sort({ createdAt: -1 })
      .skip(query.page * query.per_page)
      .limit(query.per_page),
    BatchJob.countDocuments(filter),
  ]);
  return { data, total };
}

export async function getBatchJob(tenantId: string, id: string) {
  const job = await BatchJob.findOne({ _id: id, tenantId });
  if (!job) throw new NotFoundError("Batch job");
  const items = await BatchJobItem.find({ tenantId, batchJobId: id }).sort({ index: 1 });
  return { job, items };
}

export async function batchJobFailures(tenantId: string, id: string, page: number, perPage: number) {
  const job = await BatchJob.findOne({ _id: id, tenantId });
  if (!job) throw new NotFoundError("Batch job");
  const filter = { tenantId, batchJobId: id, status: "FAILED" };
  const [data, total] = await Promise.all([
    BatchJobItem.find(filter)
      .sort({ index: 1 })
      .skip(page * perPage)
      .limit(perPage),
    BatchJobItem.countDocuments(filter),
  ]);
  return { data, total };
}
