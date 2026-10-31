import PDFDocument from "pdfkit";
import { formatMoney } from "@brightloop/shared";

export interface PdfInvoice {
  number: string;
  status: string;
  invoiceDate: Date;
  dueDate: Date | null;
  currency: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  amountDue: string;
  customerName: string;
  customerEmail: string | null;
  lineItems: Array<{
    name: string;
    description?: string | null;
    quantity: string;
    unitPrice: string;
    amountTotal: string;
  }>;
}

function renderHeader(doc: PDFKit.PDFDocument, title: string, number: string) {
  doc.rect(0, 0, doc.page.width, 96).fill("#5b52e8");
  doc.fillColor("#ffffff").fontSize(24).text("BrightLoop", 48, 32);
  doc.fontSize(12).text(title, 48, 64);
  doc.fontSize(12).text(number, 400, 64, { width: 150, align: "right" });
  doc.fillColor("#111111");
  doc.moveDown(3);
}

export async function generateInvoicePdf(invoice: PdfInvoice): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    renderHeader(doc, "Invoice", invoice.number);
    doc.fontSize(10).fillColor("#555555");
    doc.text(`Issued: ${invoice.invoiceDate.toISOString().slice(0, 10)}`);
    doc.text(`Due: ${invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : "On receipt"}`);
    doc.text(`Status: ${invoice.status}`);
    doc.moveDown();
    doc.fillColor("#111111").fontSize(12).text(`Billed to: ${invoice.customerName}`);
    if (invoice.customerEmail) doc.fontSize(10).fillColor("#555555").text(invoice.customerEmail);
    doc.moveDown(1.5);

    const tableTop = doc.y;
    doc.fontSize(10).fillColor("#555555");
    doc.text("Description", 48, tableTop);
    doc.text("Qty", 330, tableTop, { width: 50, align: "right" });
    doc.text("Unit", 390, tableTop, { width: 60, align: "right" });
    doc.text("Amount", 460, tableTop, { width: 80, align: "right" });
    doc.moveTo(48, tableTop + 16).lineTo(542, tableTop + 16).strokeColor("#dddddd").stroke();
    let y = tableTop + 24;
    doc.fillColor("#111111");
    for (const line of invoice.lineItems) {
      doc.fontSize(10).text(line.name, 48, y, { width: 260 });
      if (line.description) doc.fontSize(8).fillColor("#777777").text(line.description, 48, y + 12, { width: 260 });
      doc.fontSize(10).fillColor("#111111");
      doc.text(line.quantity, 330, y, { width: 50, align: "right" });
      doc.text(line.unitPrice, 390, y, { width: 60, align: "right" });
      doc.text(line.amountTotal, 460, y, { width: 80, align: "right" });
      y += line.description ? 34 : 22;
    }

    doc.moveTo(330, y + 4).lineTo(542, y + 4).strokeColor("#dddddd").stroke();
    y += 16;
    doc.fontSize(10).fillColor("#555555").text("Subtotal", 330, y, { width: 120, align: "right" });
    doc.fillColor("#111111").text(formatMoney(invoice.subtotal, invoice.currency), 460, y, { width: 80, align: "right" });
    y += 18;
    doc.fillColor("#555555").text("Tax", 330, y, { width: 120, align: "right" });
    doc.fillColor("#111111").text(formatMoney(invoice.taxAmount, invoice.currency), 460, y, { width: 80, align: "right" });
    y += 18;
    doc.fontSize(12).fillColor("#111111").text("Total", 330, y, { width: 120, align: "right" });
    doc.text(formatMoney(invoice.total, invoice.currency), 460, y, { width: 80, align: "right" });
    y += 20;
    doc.fontSize(10).fillColor("#555555").text("Amount due", 330, y, { width: 120, align: "right" });
    doc.fillColor("#111111").text(formatMoney(invoice.amountDue, invoice.currency), 460, y, { width: 80, align: "right" });

    doc.fontSize(8).fillColor("#999999").text("Generated locally by BrightLoop. No external billing provider was contacted.", 48, 780, {
      width: 496,
      align: "center",
    });
    doc.end();
  });
}

export async function generateCreditNotePdf(note: {
  number: string;
  invoiceNumber: string;
  customerName: string;
  currency: string;
  total: string;
  reason: string;
  issuedAt: Date | null;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    renderHeader(doc, "Credit note", note.number);
    doc.fontSize(11).fillColor("#111111").text(`Invoice: ${note.invoiceNumber}`);
    doc.text(`Customer: ${note.customerName}`);
    doc.text(`Issued: ${(note.issuedAt ?? new Date()).toISOString().slice(0, 10)}`);
    doc.moveDown();
    doc.text(`Reason: ${note.reason}`);
    doc.moveDown();
    doc.fontSize(16).text(`Credit total: ${formatMoney(note.total, note.currency)}`);
    doc.fontSize(8).fillColor("#999999").text("Generated locally by BrightLoop.", 48, 780, {
      width: 496,
      align: "center",
    });
    doc.end();
  });
}
