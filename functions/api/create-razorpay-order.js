/**
 * VELORA — POST /api/create-razorpay-order
 *
 * Creates a Razorpay order server-side using the secret key.
 * Returns only the public key_id to the frontend — secret never leaves the server.
 *
 * Required env vars (set in Cloudflare Pages → Settings → Environment variables):
 *   RAZORPAY_KEY_ID     — e.g. rzp_test_xxxxxxxxxxxx
 *   RAZORPAY_KEY_SECRET — never commit; set via dashboard only
 *
 * Returns 503 when Razorpay is not configured so the frontend can fall back
 * gracefully to demo mode.
 */

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Content-Type': 'application/json' } });
}
function err(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

export async function onRequestPost(context) {
  try {
    const KEY_ID     = context.env?.RAZORPAY_KEY_ID;
    const KEY_SECRET = context.env?.RAZORPAY_KEY_SECRET;

    // Return 503 so the frontend knows to fall back to demo mode
    if (!KEY_ID || !KEY_SECRET) {
      return err('Razorpay not configured', 503);
    }

    let body;
    try { body = await context.request.json(); }
    catch { return err('Invalid JSON body'); }

    const amount = Number(body.amount); // INR, can be decimal
    if (!isFinite(amount) || amount <= 0) return err('Invalid amount');

    const amountPaise   = Math.round(amount * 100); // Razorpay requires paise
    const velora_order_id = 'VEL-' + Date.now().toString(36).toUpperCase()
                          + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const receipt = velora_order_id.slice(0, 40); // Razorpay receipt max 40 chars

    // Create Razorpay order — secret used only here, server-side
    const credentials = btoa(`${KEY_ID}:${KEY_SECRET}`);
    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt,
        payment_capture: 1,
      }),
    });

    if (!rzpRes.ok) {
      const detail = await rzpRes.text().catch(() => '');
      console.error('[VELORA] Razorpay order creation failed:', rzpRes.status, detail);
      return err('Failed to create payment order', 502);
    }

    const rzpOrder = await rzpRes.json();

    return json({
      ok:               true,
      razorpay_order_id: rzpOrder.id,
      velora_order_id,
      amount:           rzpOrder.amount,   // paise, echoed back for modal
      currency:         rzpOrder.currency,
      key_id:           KEY_ID,            // public key only — safe to send to frontend
    }, 201);

  } catch (e) {
    console.error('[VELORA] create-razorpay-order error:', e);
    return err('Internal server error', 500);
  }
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return err(`Method ${context.request.method} not allowed`, 405);
}
