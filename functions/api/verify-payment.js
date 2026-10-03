/**
 * VELORA — POST /api/verify-payment
 *
 * 1. Verifies Razorpay payment signature server-side (HMAC-SHA256).
 *    Uses Web Crypto API — no external libraries needed.
 * 2. Only after a valid signature: saves the order to D1 with status='paid'.
 *
 * Required env vars:
 *   RAZORPAY_KEY_SECRET — used only for signature verification; never exposed
 *   DB                  — D1 binding (velora-orders)
 */

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Content-Type': 'application/json' } });
}
function err(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

/**
 * Razorpay signature = HMAC-SHA256(razorpay_order_id + "|" + razorpay_payment_id, secret)
 */
async function verifySignature(razorpay_order_id, razorpay_payment_id, signature, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const data      = encoder.encode(`${razorpay_order_id}|${razorpay_payment_id}`);
  const hashBuf   = await crypto.subtle.sign('HMAC', key, data);
  const hashHex   = Array.from(new Uint8Array(hashBuf))
                      .map(b => b.toString(16).padStart(2, '0'))
                      .join('');
  return hashHex === signature;
}

export async function onRequestPost(context) {
  try {
    const KEY_SECRET = context.env?.RAZORPAY_KEY_SECRET;
    if (!KEY_SECRET) return err('Razorpay not configured', 503);

    let body;
    try { body = await context.request.json(); }
    catch { return err('Invalid JSON body'); }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order } = body;

    // ── Validate incoming fields ──────────────────────────────────────────────
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
      return err('Missing Razorpay payment fields');

    if (!order?.id || !order?.customer || !order?.shipping || !Array.isArray(order?.items))
      return err('Missing or malformed order data');

    // ── Verify signature ──────────────────────────────────────────────────────
    const valid = await verifySignature(
      razorpay_order_id, razorpay_payment_id, razorpay_signature, KEY_SECRET
    );
    if (!valid) {
      console.warn('[VELORA] Invalid payment signature — order:', order.id);
      return err('Payment signature verification failed', 400);
    }

    // ── Persist to D1 with status = paid ─────────────────────────────────────
    // Only reached after a genuine verified Razorpay payment.
    // DB undefined in local dev without wrangler — logs warning but still returns success.
    if (context.env?.DB) {
      await context.env.DB.prepare(`
        INSERT INTO orders
          (id, created_at, status,
           customer_name, customer_email, customer_phone,
           shipping_address, shipping_city, shipping_state, shipping_zip, shipping_country,
           shipping_method, shipping_cost,
           subtotal, total, items)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        order.id,
        order.createdAt || new Date().toISOString(),
        'paid',
        order.customer.name,    order.customer.email,    order.customer.phone,
        order.shipping.address, order.shipping.city,     order.shipping.state,
        order.shipping.zip,     order.shipping.country,
        order.shipping.method,  order.shipping.cost,
        order.subtotal,         order.total,
        JSON.stringify(order.items)
      ).run();
    } else {
      console.warn('[VELORA] DB not bound — verified payment not persisted');
    }

    return json({
      ok:        true,
      orderId:   order.id,
      paymentId: razorpay_payment_id,
      status:    'paid',
    });

  } catch (e) {
    console.error('[VELORA] verify-payment error:', e);
    return err('Internal server error', 500);
  }
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return err(`Method ${context.request.method} not allowed`, 405);
}
