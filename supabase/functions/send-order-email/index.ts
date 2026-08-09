import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import nodemailer from "npm:nodemailer@7.0.5";

type EmailType = "order_confirmed" | "order_completed" | "receipt";

type OrderEmailItem = {
  name?: string;
  quantity?: number;
  addons?: string[] | string;
  customizations?: Record<string, string | string[]>;
  subtotal?: number | string;
};

type OrderEmailPayload = {
  type?: EmailType;
  to?: string;
  order?: {
    order_number?: string;
    reference_code?: string;
    customer_name?: string;
    order_type_label?: string;
    order_date?: string;
    schedule?: string;
    payment_method?: string;
    payment_reference?: string;
    bank_name?: string;
    cashier_name?: string;
    subtotal?: number | string;
    discount?: number | string;
    discount_label?: string;
    delivery_fee?: number | string;
    total_amount?: number | string;
    items?: OrderEmailItem[];
  };
  receipt_html?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const storeProfile = {
  name: Deno.env.get("STORE_NAME") || "thecoffeerealm",
  address:
    Deno.env.get("STORE_ADDRESS") ||
    "Lot 1 Block 210 Mark Street corner Dollar Street, Quezon City",
  contact: Deno.env.get("STORE_CONTACT") || "+63 997 533 7958",
  fromEmail: Deno.env.get("GMAIL_SMTP_USER") || "",
  fromName: Deno.env.get("MAIL_FROM_NAME") || "thecoffeerealm",
  bannerImage:
    Deno.env.get("MAIL_BANNER_IMAGE") ||
    "https://res.cloudinary.com/dkpdilkin/image/upload/f_auto,q_auto,w_1200/emailbg_miswbo.jpg",
};

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const money = (value: unknown) => {
  const numeric =
    typeof value === "number"
      ? value
      : Number(String(value ?? "0").replace(/[^0-9.-]/g, ""));
  return `PHP ${Number.isFinite(numeric) ? numeric.toFixed(2) : "0.00"}`;
};

const normalizeList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
};

const formatCustomizations = (item: OrderEmailItem) => {
  const rows: string[] = [];
  const customizations = item.customizations || {};

  Object.entries(customizations).forEach(([key, value]) => {
    const label = key
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
    const displayValue = Array.isArray(value) ? value.join(", ") : value;
    if (displayValue) rows.push(`${label}: ${displayValue}`);
  });

  normalizeList(item.addons).forEach((addon) => rows.push(`Add-on: ${addon}`));
  return rows;
};

const buildItemsRows = (items: OrderEmailItem[] = []) => {
  if (!items.length) {
    return `<tr><td colspan="4" style="padding:14px;text-align:center;color:#5d6f63;">No order items found.</td></tr>`;
  }

  return items
    .map((item) => {
      const options = formatCustomizations(item)
        .map(
          (line) =>
            `<div style="margin-top:4px;font-size:12px;line-height:18px;color:#6b7d70;">+ ${escapeHtml(line)}</div>`,
        )
        .join("");

      return `<tr>
        <td style="padding:12px;border-bottom:1px solid #e6efe8;color:#1f2f26;">
          <strong>${escapeHtml(item.name || "Menu item")}</strong>${options}
        </td>
        <td style="padding:12px;border-bottom:1px solid #e6efe8;color:#1f2f26;text-align:center;">${escapeHtml(
          item.quantity || 0,
        )}</td>
        <td style="padding:12px;border-bottom:1px solid #e6efe8;color:#1f2f26;text-align:right;">${money(
          item.subtotal,
        )}</td>
      </tr>`;
    })
    .join("");
};

const buildOrderEmailHtml = (payload: Required<Pick<OrderEmailPayload, "type" | "order">>) => {
  const order = payload.order || {};
  const isCompleted = payload.type === "order_completed";
  const title = isCompleted ? "Your Order Is Complete" : "Your Order Has Been Confirmed";
  const intro = isCompleted
    ? "Thank you for choosing thecoffeerealm. Your order is now complete."
    : "Your payment has been verified. Your order is now being prepared.";
  const note = isCompleted
    ? "Your receipt is attached to this email for your records."
    : "We will keep your order moving through the queue.";
  const itemsRows = buildItemsRows(order.items || []);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#eef3ef;font-family:Arial,Helvetica,sans-serif;color:#1f2f26;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#eef3ef;width:100%;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;width:100%;">
          <tr>
            <td style="background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 24px rgba(31,47,38,.10);">
              <img src="${escapeHtml(storeProfile.bannerImage)}" alt="thecoffeerealm" width="640" style="display:block;width:100%;height:auto;border:0;">
              <div style="padding:32px 32px 12px;text-align:center;">
                <div style="font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#2f5c46;margin-bottom:10px;">thecoffeerealm</div>
                <h1 style="margin:0;color:#1b2d22;font-size:30px;line-height:38px;">${escapeHtml(title)}</h1>
              </div>
              <div style="padding:0 32px 18px;text-align:center;font-size:16px;line-height:26px;color:#4f6358;">${escapeHtml(
                intro,
              )}</div>
              <div style="padding:0 24px 14px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f7faf7;border-radius:12px;">
                  <tr><td style="padding:12px 14px;font-size:14px;color:#2f5c46;"><strong>Order #:</strong> ${escapeHtml(
                    order.order_number || "N/A",
                  )}</td></tr>
                  <tr><td style="padding:0 14px 12px;font-size:14px;color:#2f5c46;"><strong>Reference:</strong> ${escapeHtml(
                    order.reference_code || "N/A",
                  )}</td></tr>
                  <tr><td style="padding:0 14px 12px;font-size:14px;color:#2f5c46;"><strong>Customer:</strong> ${escapeHtml(
                    order.customer_name || "Customer",
                  )}</td></tr>
                  <tr><td style="padding:0 14px 12px;font-size:14px;color:#2f5c46;"><strong>Order Type:</strong> ${escapeHtml(
                    order.order_type_label || "Order",
                  )}</td></tr>
                  <tr><td style="padding:0 14px 12px;font-size:14px;color:#2f5c46;"><strong>Date:</strong> ${escapeHtml(
                    order.order_date || "N/A",
                  )}</td></tr>
                  <tr><td style="padding:0 14px 12px;font-size:14px;color:#2f5c46;"><strong>Payment Method:</strong> ${escapeHtml(
                    order.payment_method || "N/A",
                  )}</td></tr>
                  <tr><td style="padding:0 14px 14px;font-size:14px;color:#2f5c46;"><strong>Total:</strong> ${money(
                    order.total_amount,
                  )}</td></tr>
                </table>
              </div>
              <div style="padding:0 24px 10px;font-size:15px;color:#1f2f26;"><strong>Order Summary</strong></div>
              <div style="padding:0 24px 10px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #dfe8e1;border-radius:12px;overflow:hidden;">
                  <tr>
                    <th align="left" style="padding:10px 12px;background:#edf5ef;font-size:13px;color:#2f5c46;">Item</th>
                    <th align="center" style="padding:10px 12px;background:#edf5ef;font-size:13px;color:#2f5c46;">Qty</th>
                    <th align="right" style="padding:10px 12px;background:#edf5ef;font-size:13px;color:#2f5c46;">Subtotal</th>
                  </tr>
                  ${itemsRows}
                  <tr>
                    <td colspan="2" style="padding:12px;font-size:14px;color:#1f2f26;text-align:right;"><strong>Total</strong></td>
                    <td style="padding:12px;font-size:14px;color:#1f2f26;text-align:right;"><strong>${money(
                      order.total_amount,
                    )}</strong></td>
                  </tr>
                </table>
              </div>
              <div style="padding:8px 24px 0;text-align:center;font-size:14px;line-height:22px;color:#5d6f63;">${escapeHtml(
                note,
              )}</div>
              <div style="padding:24px 32px 30px;text-align:center;font-size:13px;line-height:21px;color:#708278;">
                If you did not place this order, please contact thecoffeerealm support.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

const buildReceiptHtml = (order: OrderEmailPayload["order"] = {}) => {
  const items = order.items || [];
  const itemRows =
    items
      .map((item) => {
        const customLines = formatCustomizations(item)
          .map((line) => `<div class="receipt-option">+ ${escapeHtml(line)}</div>`)
          .join("");
        return `<div class="receipt-item">
          <div>${escapeHtml(item.quantity || 0)}</div>
          <div class="receipt-item-name">${escapeHtml(item.name || "Menu item")}${customLines}</div>
          <div class="receipt-item-price">${money(item.subtotal).replace("PHP ", "")}</div>
        </div>`;
      })
      .join("") || `<div class="receipt-row"><span>No items</span><span></span></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    @page{size:80mm auto;margin:0}
    html,body{margin:0;padding:0;width:80mm;max-width:80mm;background:#fff;color:#000;font-family:"Courier New",Courier,monospace;font-size:11px;line-height:1.3}
    *{box-sizing:border-box}
    .receipt{width:80mm;padding:8px;background:#fff;color:#000}
    .receipt-header,.receipt-footer{text-align:center;word-break:break-word}
    .receipt-store-name{font-size:15px;font-weight:800;letter-spacing:1px;text-transform:uppercase}
    .receipt-line{border-top:1px dashed #000;margin:6px 0}
    .receipt-table-header,.receipt-item{display:grid;grid-template-columns:24px minmax(0,1fr) 58px;gap:4px;width:100%}
    .receipt-table-header{font-weight:800}
    .receipt-item{margin:3px 0}
    .receipt-item-name{word-break:break-word}
    .receipt-item-price{text-align:right;white-space:nowrap;overflow:hidden}
    .receipt-option{font-size:10px;margin-top:2px}
    .receipt-total-row,.receipt-row{display:flex;justify-content:space-between;gap:6px;width:100%}
    .receipt-total-row span:last-child,.receipt-row span:last-child{text-align:right;white-space:nowrap}
    .receipt-grand-total{font-weight:900;font-size:14px}
  </style>
</head>
<body>
  <div class="receipt">
    <div class="receipt-header">
      <div class="receipt-store-name">${escapeHtml(storeProfile.name)}</div>
      <div>${escapeHtml(storeProfile.address)}</div>
      <div>${escapeHtml(storeProfile.contact)}</div>
    </div>
    <div class="receipt-line"></div>
    <div class="receipt-row"><span>Order #:</span><span>${escapeHtml(order.order_number || "N/A")}</span></div>
    <div class="receipt-row"><span>Reference #:</span><span>${escapeHtml(order.reference_code || "N/A")}</span></div>
    <div class="receipt-row"><span>Date:</span><span>${escapeHtml(order.order_date || "N/A")}</span></div>
    <div class="receipt-row"><span>Type:</span><span>${escapeHtml(order.order_type_label || "Order")}</span></div>
    ${
      order.cashier_name
        ? `<div class="receipt-row"><span>Cashier:</span><span>${escapeHtml(order.cashier_name)}</span></div>`
        : ""
    }
    <div class="receipt-line"></div>
    <div class="receipt-table-header"><div>QTY</div><div>ITEM</div><div style="text-align:right">PRICE</div></div>
    <div class="receipt-line"></div>
    ${itemRows}
    <div class="receipt-line"></div>
    <div class="receipt-total-row"><span>Subtotal:</span><span>${money(order.subtotal).replace("PHP ", "")}</span></div>
    ${
      Number(order.discount || 0) > 0
        ? `<div class="receipt-total-row"><span>${escapeHtml(order.discount_label || "Discount")}:</span><span>-${money(
            order.discount,
          ).replace("PHP ", "")}</span></div>`
        : ""
    }
    ${
      Number(order.delivery_fee || 0) > 0
        ? `<div class="receipt-total-row"><span>Delivery Fee:</span><span>${money(order.delivery_fee).replace(
            "PHP ",
            "",
          )}</span></div>`
        : ""
    }
    <div class="receipt-total-row"><span>TOTAL:</span><span class="receipt-grand-total">${money(
      order.total_amount,
    ).replace("PHP ", "")}</span></div>
    <div class="receipt-line"></div>
    <div class="receipt-row"><span>Payment Method:</span><span>${escapeHtml(order.payment_method || "N/A")}</span></div>
    ${
      order.payment_reference
        ? `<div class="receipt-row"><span>Payment Ref:</span><span>${escapeHtml(order.payment_reference)}</span></div>`
        : ""
    }
    ${
      order.bank_name
        ? `<div class="receipt-row"><span>Bank Name:</span><span>${escapeHtml(order.bank_name)}</span></div>`
        : ""
    }
    <div class="receipt-line"></div>
    <div class="receipt-footer">Thank you for choosing thecoffeerealm,<br>Enjoy your drink and have a great day!</div>
    <div class="receipt-line"></div>
  </div>
</body>
</html>`;
};

const sendWithGmail = async (payload: {
  to: string;
  subject: string;
  html: string;
  receiptHtml?: string;
}) => {
  const gmailAppPassword = Deno.env.get("GMAIL_SMTP_APP_PASSWORD") || "";
  if (!storeProfile.fromEmail) throw new Error("GMAIL_SMTP_USER is not configured.");
  if (!gmailAppPassword) throw new Error("GMAIL_SMTP_APP_PASSWORD is not configured.");

  const attachments = payload.receiptHtml
    ? [
        {
          filename: "thecoffeerealm-receipt.html",
          content: payload.receiptHtml,
          contentType: "text/html; charset=utf-8",
        },
      ]
    : [];

  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: storeProfile.fromEmail,
      pass: gmailAppPassword,
    },
  });

  return transport.sendMail({
    from: `${storeProfile.fromName} <${storeProfile.fromEmail}>`,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    attachments,
  });
};

const authorizeStaff = async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const authorization = req.headers.get("Authorization") || "";
  if (!supabaseUrl || !anonKey || !serviceKey || !authorization.startsWith("Bearer ")) {
    throw new Error("Authentication required.");
  }
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authorization },
  });
  if (!userResponse.ok) throw new Error("Invalid or expired session.");
  const user = await userResponse.json();
  const profileResponse = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
  if (!profileResponse.ok) throw new Error("Could not verify staff access.");
  const profiles = await profileResponse.json();
  if (!profiles.length || !["admin", "cashier"].includes(profiles[0].role)) {
    throw new Error("Admin or cashier access required.");
  }
};
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    await authorizeStaff(req);
    const payload = (await req.json()) as OrderEmailPayload;
    const type = payload.type || "receipt";
    const order = payload.order || {};
    const to = String(payload.to || "").trim();

    if (!to) throw new Error("Recipient email is required.");

    const receiptHtml = payload.receipt_html || buildReceiptHtml(order);
    const subject =
      type === "order_completed"
        ? `thecoffeerealm - Order ${order.order_number || ""} completed`
        : type === "order_confirmed"
          ? `thecoffeerealm - Order ${order.order_number || ""} confirmed`
          : `thecoffeerealm - Receipt ${order.order_number || ""}`;

    const html =
      type === "receipt"
        ? receiptHtml
        : buildOrderEmailHtml({ type, order });

    const result = await sendWithGmail({
      to,
      subject,
      html,
      receiptHtml: type === "order_completed" || type === "receipt" ? receiptHtml : undefined,
    });

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
