// server/services/invoice.service.js
// ---------------------------------------------------------
// Lightweight, Chrome-free PDF invoice generator using pdfkit
// Works in Node/Docker without installing Chrome.
// ---------------------------------------------------------

import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

// ---- Helpers ---------------------------------------------------------------
const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Math.round(n || 0));

function ensureDir(dir) {
  return fs.promises.mkdir(dir, { recursive: true });
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

// If you need strictly sequential invoice numbers, generate them in DB (txn!).
// This fallback uses date + short id which is unique but not strictly sequential.
function fallbackInvoiceNumber(prefix = 'INV') {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const short = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}/${y}${m}${dd}/${short}`;
}

// Draw a simple table
function drawTable(doc, { x, y, colWidths, headers, rows }) {
  const rowHeight = 22;
  const borderYPad = 6;
  doc.lineWidth(0.7);

  // Header background
  doc.save();
  doc.rect(x, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fillOpacity(0.06).fill('#000');
  doc.fillOpacity(1);
  doc.stroke();

  // Header text
  doc.fill('#000').fontSize(10).font('Helvetica-Bold');
  let cx = x + 6;
  headers.forEach((h, i) => {
    const colW = colWidths[i];
    doc.text(h, cx, y + 7, { width: colW - 12, ellipsis: true });
    cx += colW;
  });

  // Rows
  doc.font('Helvetica');
  let cy = y + rowHeight;
  rows.forEach((r, idx) => {
    // row border
    doc.lineWidth(0.5).strokeColor('#AAA');
    doc.moveTo(x, cy).lineTo(x + colWidths.reduce((a, b) => a + b, 0), cy).stroke();
    let cx2 = x + 6;
    r.forEach((cell, i) => {
      const colW = colWidths[i];
      doc.fillColor('#000').fontSize(10);
      const opts = { width: colW - 12, ellipsis: true, align: i >= (r.length - 2) ? 'right' : 'left' };
      doc.text(cell, cx2, cy + 7 - borderYPad / 2, opts);
      cx2 += colW;
    });
    cy += rowHeight;
  });

  return cy; // bottom y
}

// Main API
export async function generateInvoicePDF({
  order, // { id, orderId (alias), createdAt, paymentMode, couponCode, discountAmount, totals: { subtotal, discount, delivery, grandTotal }, invoiceNumber? }
  items, // [{ productName, size, quantity, price, totalPrice }]
  billing, // { name, phone, address }
  seller = { // Use ENV in real app
    name: process.env.STORE_NAME || 'Your Store Pvt Ltd',
    address: process.env.STORE_ADDRESS || 'Street, City, State, PIN',
    phone: process.env.STORE_PHONE || '+91-XXXXXXXXXX',
    email: process.env.STORE_EMAIL || 'support@example.com',
    gstin: process.env.STORE_GSTIN || undefined,
  },
  outputDir = path.resolve('storage', 'invoices'),
  fileName, // optional manual override
}) {
  const invoiceNumber = order.invoiceNumber || fallbackInvoiceNumber();
  const name = fileName || `${invoiceNumber.replace(/[\\/]/g, '-')}.pdf`;
  const dir = path.resolve(outputDir, String(new Date().getFullYear()));
  await ensureDir(dir);
  const filePath = path.join(dir, name);

  return await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const write = fs.createWriteStream(filePath);

    write.on('finish', () => resolve({
      invoiceNumber,
      filePath,
      publicUrl: `/invoices/${new Date().getFullYear()}/${encodeURIComponent(name)}`,
    }));
    write.on('error', reject);

    doc.pipe(write);

    // Header
    doc.font('Helvetica-Bold').fontSize(18).text('Tax Invoice', { align: 'right' });

    // Seller block
    doc.moveDown(0.5);
    doc.fontSize(12).text(seller.name);
    doc.font('Helvetica').fontSize(10).text(seller.address);
    if (seller.gstin) doc.text(`GSTIN: ${seller.gstin}`);
    doc.text(`Phone: ${seller.phone}`);
    doc.text(`Email: ${seller.email}`);

    // Meta + Bill To
    const topY = 120;
    doc.moveTo(36, topY - 8).lineTo(559, topY - 8).lineWidth(0.5).strokeColor('#ddd').stroke();

    // Bill To
    doc.font('Helvetica-Bold').fontSize(12).text('Bill To', 36, topY);
    doc.font('Helvetica').fontSize(10)
      .text(billing?.name || '-', 36, topY + 18)
      .text(billing?.address || '-', 36, topY + 34, { width: 260 })
      .text(`Phone: ${billing?.phone || '-'}`, 36, topY + 74);

    // Invoice meta (right)
    const rX = 330;
    const meta = [
      ['Invoice No.', invoiceNumber],
      ['Invoice Date', todayISO()],
      ['Order ID', order.id || order.orderId],
      ['Payment Mode', (order.paymentMode || '').toUpperCase()],
    ];
    doc.font('Helvetica-Bold').text('Details', rX, topY);
    doc.font('Helvetica');
    meta.forEach((row, i) => {
      doc.text(`${row[0]}: ${row[1]}`, rX, topY + 18 + i * 16);
    });

    // Items table
    const startY = 220;
    const colWidths = [28, 250, 70, 60, 80, 70];
    const headers = ['#', 'Item', 'Size', 'Qty', 'Unit Price', 'Amount'];

    const rows = items.map((it, i) => [
      String(i + 1),
      it.productName,
      it.size || '-',
      String(it.quantity),
      inr(it.price),
      inr(it.totalPrice),
    ]);

    let bottomY = drawTable(doc, { x: 36, y: startY, colWidths, headers, rows });

    // Totals block
    const totalsX = 360;
    const lineY = bottomY + 10;
    doc.moveTo(36, lineY).lineTo(559, lineY).lineWidth(0.5).strokeColor('#ddd').stroke();

    const totals = [
      ['Subtotal', inr(order.totals?.subtotal ?? 0)],
      ['Discount', `- ${inr(order.totals?.discount ?? 0)}`],
      ['Delivery', inr(order.totals?.delivery ?? 0)],
      ['Grand Total', inr(order.totals?.grandTotal ?? 0)],
    ];

    doc.font('Helvetica-Bold').fontSize(11).text('Totals', totalsX, lineY + 8);
    doc.font('Helvetica').fontSize(11);
    totals.forEach((t, i) => {
      const y = lineY + 28 + i * 18;
      doc.text(t[0], totalsX, y, { width: 120 });
      doc.text(t[1], totalsX + 160, y, { width: 100, align: 'right' });
    });

    // Notes
    const notesY = lineY + 28 + totals.length * 18 + 16;
    doc.fontSize(9).fillColor('#555').text('Thank you for your purchase!', 36, notesY);
    doc.text('This is a computer-generated invoice and does not require a signature.', 36, notesY + 14);

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Example integration in your payment controller (pseudo-diff)
// ---------------------------------------------------------------------------
// import { generateInvoicePDF } from '../services/invoice.service.js';
// ... after you insert order + orderItems and reduce stock, call:
/*
const totals = { subtotal: productTotal, discount: discountAmount, delivery: deliveryCharge, grandTotal: finalAmount };
const billing = { name: user.name, phone, address: billingAddressString }; // snapshot string you build from userAddressId

const { invoiceNumber, publicUrl } = await generateInvoicePDF({
  order: { id: orderId, paymentMode, couponCode, discountAmount, totals },
  items: enrichedItems,
  billing,
});

// Save URL/number on order
await db.update(ordersTable)
  .set({ invoiceNumber, invoicePdfUrl: publicUrl, updatedAt: new Date().toISOString() })
  .where(eq(ordersTable.id, orderId));
*/

// If you need strictly sequential invoice numbers, create a tiny counter table
// and allocate the number inside the same DB transaction as the order insert.
/* Example schema idea (pseudo):
CREATE TABLE invoice_counters (
  id SERIAL PRIMARY KEY,
  series TEXT NOT NULL UNIQUE, -- e.g., 'FY2025-26'
  current INTEGER NOT NULL DEFAULT 0
);
// In txn: SELECT FOR UPDATE current; UPDATE current = current + 1; build number as `INV/FY2025-26/${current}`.
*/
