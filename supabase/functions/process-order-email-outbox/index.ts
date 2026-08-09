import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import nodemailer from "npm:nodemailer@7.0.5";

type OutboxEvent = {
  id: string;
  order_id: string;
  customer_id?: string | null;
  event_type: string;
  recipient_email: string;
  payload: Record<string, unknown>;
  status: "pending" | "processing" | "sent" | "failed";
  attempt_count: number;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const gmailUser = Deno.env.get("GMAIL_SMTP_USER") || "";
const gmailAppPassword = Deno.env.get("GMAIL_SMTP_APP_PASSWORD") || "";
const fromName = Deno.env.get("MAIL_FROM_NAME") || "thecoffeerealm";
const storeName = Deno.env.get("STORE_NAME") || "thecoffeerealm";
const storeAddress = Deno.env.get("STORE_ADDRESS") || "Lot 1 Block 210 Mark Street corner Dollar Street, Quezon City";
const storeContact = Deno.env.get("STORE_CONTACT") || "+63 997 533 7958";
const bannerImage = Deno.env.get("MAIL_BANNER_IMAGE") || "https://res.cloudinary.com/dkpdilkin/image/upload/f_auto,q_auto,w_1200/emailbg_miswbo.jpg";

const mailTransport = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: gmailUser,
    pass: gmailAppPassword,
  },
});

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const money = (value: unknown) => {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "0").replace(/[^0-9.-]/g, ""));
  return `PHP ${Number.isFinite(numeric) ? numeric.toFixed(2) : "0.00"}`;
};

const label = (value: unknown) =>
  String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const rest = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Database request failed: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

const jwtRole = (token: string) => {
  try {
    const segment = token.split(".")[1];
    if (!segment) return "";
    const normalized = segment.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return String(JSON.parse(atob(padded))?.role || "");
  } catch {
    return "";
  }
};

const getCaller = async (req: Request) => {
  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) throw new Error("Authentication required.");
  // The Edge gateway validates JWTs before this function runs. Accept both the
  // injected project key and legacy service-role JWTs during key migration.
  if (token === serviceKey || jwtRole(token) === "service_role") {
    return { id: "service_role", role: "service_role", isService: true };
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Invalid or expired session.");
  const user = await response.json();
  const profiles = await rest(`profiles?id=eq.${encodeURIComponent(user.id)}&select=role&limit=1`, {
    method: "GET",
  });
  return { id: user.id as string, role: String(profiles?.[0]?.role || "customer"), isService: false };
};

const buildEmail = (event: OutboxEvent) => {
  const data = event.payload || {};
  const orderNumber = String(data.order_number || "");
  const customerName = String(data.customer_name || "Customer");
  const reason = String(data.cancellation_reason || "No reason provided");
  const notes = String(data.cancellation_notes || "");
  const reviewNotes = String(data.review_notes || "");
  const actor = label(data.requested_by_role || data.cancelled_by_role || "the store");
  const refundAmount = money(data.refund_amount || data.final_total);
  const refundReference = String(data.refund_reference || "");
  const orderType = label(data.order_type || "Order");
  const orderTotal = money(data.final_total);

  const content: Record<string, { subject: string; title: string; intro: string; detail: string; status: string; tone: string }> = {
    order_cancelled: {
      subject: `thecoffeerealm - Order ${orderNumber} cancelled`,
      title: "Your Order Was Cancelled",
      intro: `${actor} cancelled your order.`,
      detail: "No refund is required because no verified payment was recorded for this order.",
      status: "Cancelled",
      tone: "#a33b35",
    },
    cancellation_requested: {
      subject: `thecoffeerealm - Cancellation review for ${orderNumber}`,
      title: "Cancellation Review Started",
      intro: actor === "Customer" ? "We received your cancellation request." : "The store started a cancellation review for your order.",
      detail: "Your order is on hold while the team checks the payment and refund requirements.",
      status: "Cancellation Review",
      tone: "#a66f20",
    },
    cancellation_approved_refund_pending: {
      subject: `thecoffeerealm - Refund pending for ${orderNumber}`,
      title: "Order Cancelled, Refund Pending",
      intro: `Your cancellation was approved. A refund of ${refundAmount} is now pending.`,
      detail: "We will send another email after the refund has been transferred and recorded.",
      status: "Refund Pending",
      tone: "#a66f20",
    },
    cancellation_rejected: {
      subject: `thecoffeerealm - Cancellation update for ${orderNumber}`,
      title: "Cancellation Request Update",
      intro: "Your cancellation request was not approved.",
      detail: reviewNotes || "Please contact the store if you need more information.",
      status: "Order Continuing",
      tone: "#315c45",
    },
    refund_processed: {
      subject: `thecoffeerealm - Refund completed for ${orderNumber}`,
      title: "Your Refund Was Completed",
      intro: `A refund of ${refundAmount} has been recorded as completed.`,
      detail: refundReference ? `Refund reference: ${refundReference}` : "Please keep this email for your records.",
      status: "Refund Completed",
      tone: "#315c45",
    },
  };

  const selected = content[event.event_type];
  if (!selected) throw new Error(`Unsupported email event: ${event.event_type}`);
  const reasonBlock = ["order_cancelled", "cancellation_requested", "cancellation_approved_refund_pending"].includes(event.event_type)
    ? `<div style="padding:0 24px 14px;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #dfe8e1;border-radius:12px;overflow:hidden;"><tr><td style="padding:14px 16px;font-size:14px;line-height:22px;color:#4f6358;"><strong style="color:#2f5c46;">Cancellation reason</strong><br>${escapeHtml(reason)}${notes ? `<br>${escapeHtml(notes)}` : ""}</td></tr></table></div>`
    : "";
  const refundBlock = ["cancellation_approved_refund_pending", "refund_processed"].includes(event.event_type)
    ? `<tr><td style="padding:0 14px 12px;font-size:14px;color:#2f5c46;"><strong>Refund Amount:</strong> ${escapeHtml(refundAmount)}</td></tr>${refundReference ? `<tr><td style="padding:0 14px 14px;font-size:14px;color:#2f5c46;"><strong>Refund Reference:</strong> ${escapeHtml(refundReference)}</td></tr>` : ""}`
    : "";

  return {
    subject: selected.subject,
    html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(selected.title)}</title></head>
<body style="margin:0;padding:0;background:#eef3ef;font-family:Arial,Helvetica,sans-serif;color:#1f2f26;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#eef3ef;width:100%;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;width:100%;">
        <tr><td style="background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 24px rgba(31,47,38,.10);">
          <img src="${escapeHtml(bannerImage)}" alt="${escapeHtml(storeName)}" width="640" style="display:block;width:100%;height:auto;border:0;">
          <div style="height:5px;background:${selected.tone};font-size:0;line-height:0;">&nbsp;</div>
          <div style="padding:32px 32px 12px;text-align:center;">
            <div style="font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#2f5c46;margin-bottom:10px;">${escapeHtml(storeName)}</div>
            <h1 style="margin:0;color:#1b2d22;font-size:30px;line-height:38px;">${escapeHtml(selected.title)}</h1>
          </div>
          <div style="padding:0 32px 18px;text-align:center;font-size:16px;line-height:26px;color:#4f6358;">
            Hi ${escapeHtml(customerName)}, ${escapeHtml(selected.intro)} ${escapeHtml(selected.detail)}
          </div>
          <div style="padding:0 24px 14px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f7faf7;border-radius:12px;">
              <tr><td style="padding:12px 14px;font-size:14px;color:#2f5c46;"><strong>Order #:</strong> ${escapeHtml(orderNumber || "N/A")}</td></tr>
              <tr><td style="padding:0 14px 12px;font-size:14px;color:#2f5c46;"><strong>Customer:</strong> ${escapeHtml(customerName)}</td></tr>
              <tr><td style="padding:0 14px 12px;font-size:14px;color:#2f5c46;"><strong>Order Type:</strong> ${escapeHtml(orderType)}</td></tr>
              <tr><td style="padding:0 14px 12px;font-size:14px;color:#2f5c46;"><strong>Update:</strong> ${escapeHtml(selected.status)}</td></tr>
              <tr><td style="padding:0 14px 14px;font-size:14px;color:#2f5c46;"><strong>Order Total:</strong> ${escapeHtml(orderTotal)}</td></tr>
              ${refundBlock}
            </table>
          </div>
          ${reasonBlock}
          <div style="padding:8px 24px 0;text-align:center;font-size:14px;line-height:22px;color:#5d6f63;">We will keep you informed if another action is required.</div>
          <div style="padding:24px 32px 30px;text-align:center;font-size:13px;line-height:21px;color:#708278;">
            Need help? Contact ${escapeHtml(storeName)} at ${escapeHtml(storeContact)}.<br>${escapeHtml(storeAddress)}
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
};

const claimEvent = async (event: OutboxEvent) => {
  const claimed = await rest(
    `order_email_outbox?id=eq.${encodeURIComponent(event.id)}&status=in.(pending,failed)&select=*`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "processing",
        attempt_count: Number(event.attempt_count || 0) + 1,
        last_error: null,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  return claimed?.[0] as OutboxEvent | undefined;
};

const deliver = async (event: OutboxEvent) => {
  const claimed = await claimEvent(event);
  if (!claimed) return { id: event.id, skipped: true };

  try {
    const email = buildEmail(claimed);
    const provider = await mailTransport.sendMail({
      from: `${fromName} <${gmailUser}>`,
      to: claimed.recipient_email,
      subject: email.subject,
      html: email.html,
      headers: {
        "X-CoffeeRealm-Event-ID": claimed.id,
      },
    });
    await rest(`order_email_outbox?id=eq.${encodeURIComponent(claimed.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "sent",
        provider_message_id: provider?.messageId || null,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
    return { id: claimed.id, sent: true };
  } catch (error) {
    const attempt = Number(claimed.attempt_count || 1);
    const retryMinutes = [1, 5, 15, 60, 360][Math.min(attempt - 1, 4)];
    await rest(`order_email_outbox?id=eq.${encodeURIComponent(claimed.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "failed",
        last_error: error instanceof Error ? error.message.slice(0, 1000) : "Unknown email error",
        next_attempt_at: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
    return { id: claimed.id, sent: false, error: error instanceof Error ? error.message : "Unknown email error" };
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST." }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    if (!supabaseUrl || !anonKey || !serviceKey || !gmailUser || !gmailAppPassword) {
      throw new Error("Gmail SMTP secrets are not fully configured.");
    }
    const caller = await getCaller(req);
    const body = await req.json().catch(() => ({}));
    const orderId = String(body.order_id || "").trim();
    const eventId = String(body.event_id || "").trim();
    const dispatchPending = body.dispatch_pending === true;

    if (dispatchPending && !caller.isService) throw new Error("Service role is required for batch delivery.");
    if (!dispatchPending && !orderId && !eventId) throw new Error("order_id or event_id is required.");

    if (dispatchPending) {
      const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
      await rest(`order_email_outbox?status=eq.processing&updated_at=lt.${encodeURIComponent(staleBefore)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "failed",
          last_error: "Delivery attempt timed out before completion.",
          next_attempt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
    }

    let query = "order_email_outbox?select=*&status=in.(pending,failed)&order=created_at.asc&limit=20";
    if (eventId) query += `&id=eq.${encodeURIComponent(eventId)}`;
    else if (orderId) query += `&order_id=eq.${encodeURIComponent(orderId)}`;
    else query += `&next_attempt_at=lte.${encodeURIComponent(new Date().toISOString())}`;
    const events = (await rest(query, { method: "GET" })) as OutboxEvent[];

    const staffRoles = ["admin", "staff", "operational_staff", "cashier"];
    if (!caller.isService && !staffRoles.includes(caller.role)) {
      if (events.some((event) => event.customer_id !== caller.id)) throw new Error("You cannot send email for this order.");
    }

    const results = [];
    for (const event of events) results.push(await deliver(event));
    return new Response(JSON.stringify({ success: true, processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
