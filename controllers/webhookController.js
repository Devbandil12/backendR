const razorpayWebhookHandler = async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const secret = "harsh_553588_omkar_398266_yomesh_711915";
  const body = req.body; // raw buffer

  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');

  if (signature !== expected) {
    return res.status(400).send('Invalid signature');
  }

  let parsedBody;
  try {
    parsedBody = JSON.parse(body.toString()); // ✅ better error handling
  } catch (err) {
    return res.status(400).send("Invalid JSON body");
  }

  const { event, payload: { refund: { entity } } } = parsedBody;
  if (!event.startsWith('refund.')) return res.status(200).send('Ignored');

  const updates = {
    refund_status: entity.status,
    refund_completed_at: entity.status === 'processed'
      ? new Date(entity.processed_at * 1000)
      : null,
    updatedAt: new Date().toISOString(),
  };

  if (entity.status === 'processed') {
    updates.paymentStatus = 'refunded';
    updates.status = 'Order Cancelled';
  }

  try {
    await db.update(ordersTable).set(updates).where(eq(ordersTable.refund_id, entity.id));
    console.log("✅ Refund update saved for refund ID:", entity.id);
    return res.status(200).send("Webhook processed");
  } catch (err) {
    console.error('❌ DB update failed:', err);
    return res.status(500).send('DB error');
  }
};
