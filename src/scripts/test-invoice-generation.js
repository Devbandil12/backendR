import { db } from '../db/client.js';
import { ordersTable } from '../db/schema/orders.schema.js';
import * as OrdersRepository from '../modules/orders/orders.repository.js';
import { generateInvoiceBuffer } from '../infrastructure/invoicing/invoice.service.js';

async function testInvoice() {
  console.log("Testing invoice generation on live orders after legacy column removal...");

  const [order] = await db.select().from(ordersTable).limit(1);
  if (!order) {
    console.log("No orders found to test invoice.");
    process.exit(0);
  }

  const orderWithDetails = await OrdersRepository.getOrderByIdWithDetails(order.id);
  const addr = orderWithDetails.address || {};
  const formattedAddress = [
    addr.address, addr.landmark, `${addr.city}, ${addr.state}`, `${addr.country} - ${addr.postalCode}`
  ].filter(Boolean).join(", ");

  const billing = {
    name: orderWithDetails.user?.name || "Guest",
    phone: orderWithDetails.address?.phone || orderWithDetails.user?.phone || "-",
    address: formattedAddress,
  };

  const items = (orderWithDetails.orderItems || []).map(item => ({
    productName: item.product?.name || "Product",
    size: item.variant?.size || "-",
    quantity: item.quantity,
    price: item.price,
    totalPrice: item.price * item.quantity
  }));

  const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
  const totalDiscount = (orderWithDetails.discountAmount || 0) + (orderWithDetails.offerDiscount || 0);
  const walletUsed = orderWithDetails.walletAmountUsed || 0;
  const deliveryCharge = Math.max(0, orderWithDetails.totalAmount - subtotal + totalDiscount + walletUsed);

  const invoiceNo = orderWithDetails.invoiceNumber || `INV-LEGACY-${orderWithDetails.id.slice(0, 8)}`;

  const orderData = {
    id: orderWithDetails.id,
    orderId: orderWithDetails.id,
    createdAt: orderWithDetails.createdAt,
    paymentMode: orderWithDetails.paymentMode,
    transactionId: orderWithDetails.transactionId,
    invoiceNumber: invoiceNo,
    shippingState: addr.state,
    totals: {
      subtotal,
      discount: totalDiscount,
      walletUsed,
      delivery: deliveryCharge,
      grandTotal: orderWithDetails.totalAmount
    }
  };

  const pdfBuffer = await generateInvoiceBuffer({
    order: orderData,
    items,
    billing
  });

  console.log(`✅ Invoice PDF generated successfully! Buffer size: ${(pdfBuffer.length / 1024).toFixed(2)} KB for Order ${order.id}`);
  process.exit(0);
}

testInvoice().catch(err => {
  console.error("INVOICE TEST ERROR:", err);
  process.exit(1);
});
