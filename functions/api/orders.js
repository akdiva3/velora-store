/**
 * VELORA — Order API
 * Route: POST /api/orders
 *
 * Cloudflare Pages Function — maps automatically to /api/orders.
 *
 * D1 setup (one-time):
 *   1. npx wrangler d1 create velora-orders
 *   2. Paste the database_id into wrangler.toml
 *   3. npx wrangler d1 execute velora-orders --file=schema.sql --remote
 *   4. Cloudflare Pages dashboard → Settings → Functions → D1 bindings
 *        variable name: DB   database: velora-orders
 *
 * Local dev with D1:
 *   npx wrangler pages dev . --port 8788
 *   (wrangler auto-provisions a local D1 replica when the binding is in wrangler.toml)
 *
 * Local dev without wrangler (demo mode):
 *   Open index.html directly — DB will be undefined; orders succeed but are not stored.
 */

// ─── Helpers ─────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function err(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

function generateOrderId() {
  const ts  = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `VEL-${ts}-${rnd}`;
}

// ─── POST /api/orders ─────────────────────────────────────────────────────────

export async function onRequestPost(context) {
  try {
    // Parse body
    let body;
    try { body = await context.request.json(); }
    catch { return err('Invalid JSON body'); }

    // Required string fields
    const REQUIRED = ['name', 'email', 'phone', 'address', 'city', 'state', 'zip', 'country'];
    const missing  = REQUIRED.filter(f => !body[f] || String(body[f]).trim() === '');
    if (missing.length) return err(`Missing required fields: ${missing.join(', ')}`);

    // Email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
      return err('Invalid email address');

    // Items
    if (!Array.isArray(body.items) || body.items.length === 0)
      return err('Order must contain at least one item');

    for (const item of body.items) {
      if (!item.id || !item.name || item.price == null || !item.qty)
        return err('Each item must include id, name, price and qty');
      if (Number(item.price) < 0 || Number(item.qty) < 1)
        return err('Item price must be ≥ 0 and qty must be ≥ 1');
    }

    // Totals
    const subtotal = Number(body.subtotal);
    const total    = Number(body.total);
    if (!isFinite(subtotal) || !isFinite(total) || total <= 0)
      return err('Invalid order totals');

    // ── Build order object ───────────────────────────────────────────────────
    const orderId = generateOrderId();
    const order = {
      id:        orderId,
      createdAt: new Date().toISOString(),
      status:    'pending',
      customer: {
        name:  body.name.trim(),
        email: body.email.trim().toLowerCase(),
        phone: body.phone.trim(),
      },
      shipping: {
        address: body.address.trim(),
        city:    body.city.trim(),
        state:   body.state.trim(),
        zip:     body.zip.trim(),
        country: body.country.trim(),
        method:  body.shippingMethod || 'standard',
        cost:    Number(body.shippingCost) || 0,
      },
      items: body.items.map(item => ({
        id:       String(item.id),
        name:     String(item.name),
        price:    Number(item.price),
        qty:      Number(item.qty),
        subtotal: Number(item.price) * Number(item.qty),
      })),
      subtotal,
      total,
    };

    // ── Persist to D1 ─────────────────────────────────────────────────────────
    // When DB is not bound (local dev without wrangler, or binding missing),
    // context.env.DB is undefined — we log a warning and still return 201 so
    // the checkout UI keeps working in demo mode.
    // In production with DB bound, any insert failure throws and the outer
    // catch returns 500, preventing a silent data-loss.
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
        order.id,               order.createdAt,          order.status,
        order.customer.name,    order.customer.email,     order.customer.phone,
        order.shipping.address, order.shipping.city,      order.shipping.state,
        order.shipping.zip,     order.shipping.country,
        order.shipping.method,  order.shipping.cost,
        order.subtotal,         order.total,
        JSON.stringify(order.items)
      ).run();
    } else {
      console.warn('[VELORA] DB not bound — order not persisted (demo/local mode)');
    }

    // ── Stage 10: confirmation email via Resend / MailChannels ───────────────
    // await sendConfirmationEmail(context.env, order);

    return json({
      ok:        true,
      orderId:   order.id,
      status:    order.status,
      createdAt: order.createdAt,
    }, 201);

  } catch (e) {
    console.error('[VELORA] Order API error:', e);
    return err('Internal server error', 500);
  }
}

// Reject non-POST requests with a clear message
export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return err(`Method ${context.request.method} not allowed`, 405);
}
