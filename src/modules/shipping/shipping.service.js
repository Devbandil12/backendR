import * as ShippingRepository from './shipping.repository.js';
import Razorpay from 'razorpay';
import { handleCodRefusal } from '../../modules/risk/cod-refusal.service.js';
import { createNotification } from '../../modules/notifications/notifications.service.js';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_ID_KEY,
  key_secret: process.env.RAZORPAY_SECRET_KEY,
});

export const mapShiprocketStatus = (rawStatus) => {
  let mappedStatus = null;
  let shouldTriggerRefund = false;
  
  switch (rawStatus) {
      case 'AWB ASSIGNED':
      case 'READY TO SHIP':
      case 'MANIFESTED':
          mappedStatus = 'Packed';
          break;
      case 'PICKED UP':
      case 'IN TRANSIT':
      case 'SHIPPED':
          mappedStatus = 'Shipped';
          break;
      case 'OUT FOR DELIVERY':
          mappedStatus = 'Out for Delivery';
          break;
      case 'DELIVERED':
          mappedStatus = 'Delivered';
          break;
      case 'CANCELLED':
      case 'NA': 
          mappedStatus = 'Order Cancelled';
          break;
      case 'RTO INITIATED':
      case 'RTO IN TRANSIT':
          mappedStatus = 'RTO Initiated';
          break;
      case 'RTO DELIVERED':
      case 'RETURN DELIVERED': 
          mappedStatus = 'Returned';
          shouldTriggerRefund = true; 
          break;
      default:
          mappedStatus = null; 
  }

  return { mappedStatus, shouldTriggerRefund };
};

export const processWebhookEvent = async (payload) => {
  const shiprocketAwb = payload.awb || payload.awb_code; 
  const rawStatus = payload.current_status; 

  const { 
      courier_name: courierName, 
      shipment_id: shiprocketShipmentId, 
      order_id: shiprocketOrderId, 
      etd: expectedDelivery 
  } = payload;

  if (!shiprocketOrderId && !shiprocketShipmentId && !shiprocketAwb) {
     throw new Error('Payload missing order_id, shipment_id, and awb');
  }

  const { mappedStatus, shouldTriggerRefund } = mapShiprocketStatus(rawStatus);

  const order = await ShippingRepository.getOrderForWebhook(shiprocketAwb, shiprocketOrderId, shiprocketShipmentId);

  if (!order) {
    return { orderFound: false, shiprocketOrderId, shiprocketShipmentId, shiprocketAwb };
  }

  const activityDescription = payload.scans?.[0]?.activity || payload.remark || rawStatus;
  const payloadScansLocation = payload.scans?.[0]?.location;

  const productIdsToInvalidate = await ShippingRepository.updateOrderAndStockInTransaction(
    order, mappedStatus, shiprocketAwb, courierName, shiprocketOrderId, shiprocketShipmentId, expectedDelivery, rawStatus, activityDescription, payloadScansLocation
  );

  if (mappedStatus === 'RTO Initiated') {
    await handleCodRefusal({ ...order, status: mappedStatus });
  }

  if (shouldTriggerRefund && order.paymentMode === 'online' && order.paymentStatus === 'paid' && order.transactionId) {
    try {
      console.log(`Processing automatic refund for Order ${order.id}...`);
      
      const payment = await razorpay.payments.fetch(order.transactionId);
      const refundInit = await razorpay.payments.refund(order.transactionId, {
        amount: payment.amount,
        speed: 'optimum',
      });
      
      await ShippingRepository.updateOrderRefundStatus(order.id, refundInit.id, refundInit.amount, refundInit.status);
      await ShippingRepository.insertTimelineEvent(
        order.id, 
        'Refunded', 
        'Refund Initiated', 
        `Your refund of ₹${(refundInit.amount / 100).toFixed(2)} has been initiated.`
      );

    } catch (refundError) {
      console.error(`⚠️ Webhook Auto-Refund Failed for Order ${order.id}:`, refundError.message);
    }
  }

  if (mappedStatus && mappedStatus !== order.status) {
    let notifyMessage = `Your order #${order.id} status is now ${mappedStatus}.`;
    if (mappedStatus === 'Out for Delivery') notifyMessage = `Out for delivery! Your order #${order.id} will reach you soon.`;
    if (mappedStatus === 'Delivered') notifyMessage = `Order #${order.id} Delivered. Enjoy your purchase!`;
    if (mappedStatus === 'Returned') notifyMessage = `Order #${order.id} has been returned successfully to our warehouse.`;

    await createNotification(
        order.userId, 
        notifyMessage, 
        `/myorder`, 
        'order'
    );
  }

  return { orderFound: true, order, mappedStatus, rawStatus, productIdsToInvalidate };
};
