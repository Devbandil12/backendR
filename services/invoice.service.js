// server/services/invoice.service.js
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

// ---- Helpers ---------------------------------------------------------------
const formatCurrency = (amount) => {
  const formattedAmount = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount || 0);
  return `Rs. ${formattedAmount}`;
};

const formatDate = (date) => {
  const d = date ? new Date(date) : new Date();
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

function ensureDir(dir) {
  return fs.promises.mkdir(dir, { recursive: true });
}

// ---- Layout Components -----------------------------------------------------

function drawHeader(doc, seller) {
  // Store Name
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(20).text(seller.name, 50, 45);

  // Store Details
  doc.fontSize(10).font('Helvetica').fillColor('#4B5563');
  doc.text(seller.address, 50, 75, { width: 250 });
  doc.text(`Email: ${seller.email}`, 50, null);
  doc.text(`Phone: ${seller.phone}`, 50, null);
  if (seller.gstin) doc.text(`GSTIN: ${seller.gstin}`, 50, null);

  // Invoice Title
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(24).text('INVOICE', 0, 45, { align: 'right', width: 545 });

  // Divider
  doc.strokeColor('#E5E7EB').lineWidth(1).moveTo(50, 145).lineTo(545, 145).stroke();
}

function drawCustomerInfo(doc, billing, order, invoiceNumber) {
  const startY = 165;

  // 🟢 ADJUSTED COLUMNS: Moved metadata column left to fit longer invoice numbers
  const col2X = 320; // Was 350
  const valX = 400;  // Was 440 (col2X + 90)
  const valWidth = 145; // Wider space for values

  // -- Left Column: Bill To --
  doc.fillColor('#6B7280').fontSize(10).font('Helvetica-Bold').text('BILLED TO', 50, startY);
  doc.fillColor('#111827').fontSize(11).font('Helvetica-Bold').text(billing.name || 'Guest', 50, startY + 15);
  doc.font('Helvetica').fontSize(10).fillColor('#374151');
  doc.text(billing.address || '-', 50, startY + 30, { width: 240 });
  doc.text(`Phone: ${billing.phone || '-'}`, 50, null);

  // -- Right Column: Invoice Meta --
  const meta = [
    { label: 'Invoice No:', value: invoiceNumber },
    { label: 'Date:', value: formatDate(order.createdAt) },
    { label: 'Order ID:', value: order.orderId },
    { label: 'Payment:', value: (order.paymentMode || 'Online').toUpperCase() },
  ];

  // 🟢 CHECK: Always add Transaction ID if it exists
  if (order.transactionId) {
    meta.push({ label: 'Txn ID:', value: order.transactionId });
  }

  let metaY = startY;
  doc.font('Helvetica');
  meta.forEach(item => {
    // Label
    doc.fillColor('#6B7280').text(item.label, col2X, metaY, { width: 75, align: 'left' });
    // Value (Right aligned in its box)
    doc.fillColor('#111827').text(item.value, valX, metaY, { width: valWidth, align: 'right' });
    metaY += 16;
  });
}

function drawTable(doc, items, startY) {
  const startX = 50;
  const colWidths = [30, 230, 60, 40, 70, 65];
  const headers = ['#', 'Item Description', 'Size', 'Qty', 'Price', 'Total'];

  let currentY = startY;

  // Header Background
  doc.fillColor('#F9FAFB').rect(startX, currentY, 495, 25).fill();

  // Header Text
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(9);
  let x = startX + 5;
  headers.forEach((h, i) => {
    const align = i >= 4 ? 'right' : 'left';
    const w = colWidths[i] - 10;
    doc.text(h, x, currentY + 8, { width: w, align });
    x += colWidths[i];
  });

  currentY += 25;

  doc.font('Helvetica').fontSize(9).fillColor('#374151');

  items.forEach((item, index) => {
    const xPositions = [];
    let curX = startX + 5;
    colWidths.forEach(w => {
      xPositions.push(curX);
      curX += w;
    });

    const values = [
      String(index + 1),
      item.productName,
      item.size || '-',
      String(item.quantity),
      formatCurrency(item.price),
      formatCurrency(item.totalPrice)
    ];

    const descWidth = colWidths[1] - 10;
    const descHeight = doc.heightOfString(item.productName, { width: descWidth });
    const rowHeight = Math.max(28, descHeight + 10);

    // 🟢 PAGE BREAK LOGIC: 
    // If current Y is past 720, we assume no room for this row + totals
    if (currentY + rowHeight > 720) {
      doc.addPage();
      currentY = 50;
    }

    doc.moveTo(startX, currentY + rowHeight).lineTo(startX + 495, currentY + rowHeight).lineWidth(0.5).strokeColor('#E5E7EB').stroke();

    values.forEach((val, i) => {
      const w = colWidths[i] - 10;
      const align = i >= 4 ? 'right' : 'left';
      const textY = (i === 1) ? currentY + 8 : currentY + (rowHeight - 10) / 2;
      doc.text(val, xPositions[i], textY, { width: w, align });
    });

    currentY += rowHeight;
  });

  return currentY;
}

function drawTotals(doc, totals, startY) {
  // 泙 INTELLIGENT PAGE BREAK
  if (startY > 680) {
    doc.addPage();
    startY = 50;
  }

  let y = startY + 15;
  const labelX = 340;
  const valX = 430;
  const valWidth = 115;

  // 🟢 Updated Lines Array to include Wallet
  const lines = [
    { label: 'Subtotal', value: totals.subtotal },
    { label: 'Discount', value: totals.discount, isNegative: true },
    { label: 'Delivery', value: totals.delivery },
    { label: 'Wallet Used', value: totals.walletUsed, isNegative: true }, // 🟢 Added this line
  ];

  doc.font('Helvetica').fontSize(10);
  lines.forEach(line => {
    // Only draw if value exists and is not 0 (except Subtotal/Delivery which might legitimately be 0, but usually we hide 0 discounts)
    if (line.value > 0) {
      doc.fillColor('#6B7280').text(line.label, labelX, y, { width: 90, align: 'left' });

      const txt = line.isNegative ? `- ${formatCurrency(line.value)}` : formatCurrency(line.value);

      doc.fillColor('#111827').text(txt, valX, y, { width: valWidth, align: 'right' });
      y += 18;
    }
  });

  // Grand Total
  y += 5;
  doc.rect(labelX - 10, y - 5, 225, 30).fillColor('#F3F4F6').fill();

  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12);
  doc.text('Grand Total', labelX, y + 4);
  doc.text(formatCurrency(totals.grandTotal), valX, y + 4, { width: valWidth, align: 'right' });
}

function drawFooter(doc) {
  const bottomY = 770;
  doc.fontSize(8).fillColor('#9CA3AF');
  doc.text('Thank you for shopping with us!', 50, bottomY, { align: 'center', width: 495 });
  doc.text('This is a computer-generated invoice.', 50, bottomY + 12, { align: 'center', width: 495 });
}

export async function generateInvoicePDF({
  order,
  items,
  billing,
  seller = {
    name: process.env.STORE_NAME || 'Your Store Pvt Ltd',
    address: process.env.STORE_ADDRESS || 'Street, City, State, PIN',
    phone: process.env.STORE_PHONE || '+91-XXXXXXXXXX',
    email: process.env.STORE_EMAIL || 'support@example.com',
    gstin: process.env.STORE_GSTIN || undefined,
  },
  outputDir = path.resolve('storage', 'invoices'),
  fileName,
}) {
  const name = `${order.invoiceNumber}.pdf`;
  const dir = path.resolve(outputDir, String(new Date().getFullYear()));

  await ensureDir(dir);
  const filePath = path.join(dir, name);

  return await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const write = fs.createWriteStream(filePath);

    write.on('finish', () => resolve({
      invoiceNumber: order.invoiceNumber,
      filePath,
      publicUrl: `/invoices/${new Date().getFullYear()}/${encodeURIComponent(name)}`,
    }));
    write.on('error', reject);

    doc.pipe(write);

    // 1. Header
    drawHeader(doc, seller);

    // 2. Customer & Meta
    drawCustomerInfo(doc, billing, order, order.invoiceNumber);

    // 3. Table - Start slightly lower to accommodate extra meta lines
    const tableBottomY = drawTable(doc, items, 275);

    // 4. Totals
    drawTotals(doc, order.totals, tableBottomY);

    // 5. Footer
    drawFooter(doc);

    doc.end();
  });
}