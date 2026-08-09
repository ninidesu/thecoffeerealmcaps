import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import nodemailer from "npm:nodemailer@7.0.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const paragraphs = (value: string) => value.split(/\n{2,}/).map((part) =>
  `<p style="margin:0 0 14px;line-height:1.7;">${escapeHtml(part).replaceAll("\n", "<br>")}</p>`).join("");
const normalizeRole = (value: unknown) => String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_")
  .replace(/^operations?_staff$/, "operational_staff");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ success: false, error: "Use POST." }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const smtpUser = Deno.env.get("GMAIL_SMTP_USER") || "";
    const smtpPassword = Deno.env.get("GMAIL_SMTP_APP_PASSWORD") || "";
    const authorization = req.headers.get("Authorization") || "";
    if (!supabaseUrl || !anonKey || !serviceKey || !authorization.startsWith("Bearer ")) throw new Error("Authentication required.");
    if (!smtpUser || !smtpPassword) throw new Error("Gmail SMTP is not configured.");

    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authorization } });
    if (!userResponse.ok) throw new Error("Invalid or expired session.");
    const user = await userResponse.json();
    const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,full_name,username,email&limit=1`, { headers: serviceHeaders });
    if (!profileResponse.ok) throw new Error("Could not verify staff access.");
    const profiles = await profileResponse.json();
    const profile = profiles[0];
    if (!profile || !["admin", "staff", "operational_staff"].includes(normalizeRole(profile.role))) throw new Error("Staff access required.");

    const body = await req.json();
    const messageId = String(body.message_id || "").trim();
    const reply = String(body.reply || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(messageId)) throw new Error("A valid message is required.");
    if (reply.length < 2 || reply.length > 5000) throw new Error("Reply must contain 2 to 5,000 characters.");
    const messageResponse = await fetch(`${supabaseUrl}/rest/v1/customer_messages?id=eq.${encodeURIComponent(messageId)}&select=*&limit=1`, { headers: serviceHeaders });
    if (!messageResponse.ok) throw new Error("Could not load the customer message.");
    const messages = await messageResponse.json();
    const message = messages[0];
    if (!message) throw new Error("Customer message not found.");

    const storeName = Deno.env.get("STORE_NAME") || "thecoffeerealm";
    const bannerImage = Deno.env.get("MAIL_BANNER_IMAGE") || "https://res.cloudinary.com/dkpdilkin/image/upload/f_auto,q_auto,w_1200/emailbg_miswbo.jpg";
    const staffName = profile.full_name || profile.username || "Customer Care Team";
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reply from ${escapeHtml(storeName)}</title></head>
    <body style="margin:0;background:#eef3ef;color:#1f2f26;font-family:Arial,Helvetica,sans-serif;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3ef;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 8px 24px rgba(31,47,38,.1);"><tr><td><img src="${escapeHtml(bannerImage)}" width="640" alt="thecoffeerealm" style="display:block;width:100%;height:auto;border:0;"></td></tr><tr><td style="padding:32px;"><div style="font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#2f5c46;">Customer care</div><h1 style="margin:8px 0 18px;font-size:28px;line-height:1.25;color:#1b2d22;">We received your message</h1><p style="margin:0 0 20px;line-height:1.7;color:#4f6358;">Hi ${escapeHtml(message.customer_name)},</p><div style="font-size:16px;color:#1f2f26;">${paragraphs(reply)}</div><div style="margin:24px 0;padding:16px 18px;border-left:4px solid #d5af67;background:#f7faf7;border-radius:0 12px 12px 0;"><div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#2f5c46;">Your original message</div><strong style="display:block;margin:7px 0;color:#1b2d22;">${escapeHtml(message.subject)}</strong><p style="margin:0;color:#5d6f63;line-height:1.6;">${escapeHtml(message.message)}</p></div><p style="margin:22px 0 0;line-height:1.6;color:#4f6358;">Warmly,<br><strong>${escapeHtml(staffName)}</strong><br>${escapeHtml(storeName)}</p></td></tr><tr><td style="padding:20px 32px;background:#1b2d22;color:#c9d5cc;text-align:center;font-size:12px;line-height:1.6;">Lot 1 Block 210 Mark Street corner Dollar Street, Quezon City<br>+63 997 533 7958</td></tr></table></td></tr></table></body></html>`;

    const transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: smtpUser, pass: smtpPassword } });
    const result = await transport.sendMail({ from: `${Deno.env.get("MAIL_FROM_NAME") || storeName} <${smtpUser}>`, to: message.customer_email, replyTo: smtpUser, subject: `thecoffeerealm reply: ${message.subject}`, html });
    const now = new Date().toISOString();
    const updateResponse = await fetch(`${supabaseUrl}/rest/v1/customer_messages?id=eq.${encodeURIComponent(messageId)}&select=*`, {
      method: "PATCH", headers: { ...serviceHeaders, Prefer: "return=representation" },
      body: JSON.stringify({ status: "replied", reply_text: reply, replied_at: now, replied_by: profile.id, email_message_id: result.messageId || null, updated_at: now }),
    });
    if (!updateResponse.ok) throw new Error("Email sent, but the inbox status could not be updated.");
    const updated = await updateResponse.json();
    return new Response(JSON.stringify({ success: true, message: updated[0] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
