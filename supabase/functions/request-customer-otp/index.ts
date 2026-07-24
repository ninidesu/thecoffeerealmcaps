import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
const otpPepper = Deno.env.get("OTP_PEPPER") || "coffee-realm-dev-pepper";
const fromEmail = Deno.env.get("MAIL_FROM_EMAIL") || "";
const fromName = Deno.env.get("MAIL_FROM_NAME") || "the coffee realm";
const bannerImage = Deno.env.get("MAIL_BANNER_IMAGE") || "https://res.cloudinary.com/dkpdilkin/image/upload/f_auto,q_auto,w_1200/emailbg_miswbo.jpg";

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const escapeHtml = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function generateOtp() {
  return crypto.getRandomValues(new Uint32Array(1))[0].toString().padStart(10, "0").slice(0, 6);
}

function buildOtpEmail(type: "registration" | "forgot_password", otp: string, userEmail: string) {
  const title = type === "forgot_password" ? "Reset Your Password" : "Verify Your Email";
  const intro = type === "forgot_password"
    ? "We received a request to reset your password. Use the OTP below to continue."
    : "Thank you for registering with the coffee realm. Use the OTP below to verify your email address.";

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background-color:#eef3ef;font-family:Arial,Helvetica,sans-serif;color:#1f2f26;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#eef3ef;margin:0;padding:0;width:100%;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;width:100%;"><tr><td style="background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 24px rgba(31,47,38,0.10);">
      <img src="${escapeHtml(bannerImage)}" alt="the coffee realm Email Banner" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;margin:0;padding:0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td style="padding:32px 32px 12px;text-align:center;"><div style="font-size:13px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#2f5c46;margin-bottom:10px;">the coffee realm</div><div style="font-size:30px;line-height:38px;font-weight:bold;color:#1b2d22;margin:0;">${escapeHtml(title)}</div></td></tr>
        <tr><td style="padding:0 32px 8px;text-align:center;font-size:16px;line-height:26px;color:#4f6358;">${escapeHtml(intro)}</td></tr>
        <tr><td style="padding:8px 32px 8px;text-align:center;font-size:14px;line-height:22px;color:#6a7c71;">Sent to: ${escapeHtml(userEmail)}</td></tr>
        <tr><td align="center" style="padding:18px 32px 10px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td align="center" style="background-color:#f4faf3;border:2px dashed #2f5c46;border-radius:16px;padding:16px 28px;"><div style="font-size:12px;line-height:18px;color:#5d6f63;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;">Your OTP Code</div><div style="font-size:36px;line-height:42px;font-weight:bold;letter-spacing:10px;color:#2f5c46;">${escapeHtml(otp)}</div></td></tr></table></td></tr>
        <tr><td style="padding:10px 32px 0;text-align:center;font-size:15px;line-height:24px;color:#244735;font-weight:bold;">This OTP will expire in 5 minutes.</td></tr>
        <tr><td style="padding:10px 32px 0;text-align:center;font-size:14px;line-height:22px;color:#7a3e00;">Do not share this code with anyone.</td></tr>
        <tr><td style="padding:24px 32px 18px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f7faf7;border-radius:12px;"><tr><td style="padding:14px 16px;font-size:13px;line-height:20px;color:#5d6f63;text-align:center;">For your security, only use the most recent OTP email we sent. Older codes will no longer work.</td></tr></table></td></tr>
        <tr><td style="padding:0 32px 30px;text-align:center;font-size:13px;line-height:21px;color:#708278;">If you did not request this email, you can safely ignore it.</td></tr>
      </table>
    </td></tr></table>
  </td></tr></table>
</body></html>`;
}

async function sendOtpEmail(to: string, otp: string) {
  if (!resendApiKey) throw new Error("RESEND_API_KEY is not configured in Supabase Edge Function secrets.");
  if (!fromEmail) throw new Error("MAIL_FROM_EMAIL is not configured in Supabase Edge Function secrets.");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [to],
      subject: "the coffee realm - Verify Your Email",
      html: buildOtpEmail("registration", otp, to),
      text: `Verify Your Email\n\nYour OTP Code: ${otp}\n\nThis OTP will expire in 5 minutes.\n\nthe coffee realm`,
    }),
  });

  if (!response.ok) throw new Error(await response.text());
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ success: false, error: "Use POST." }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase service credentials are not configured.");
    const body = await req.json();
    const email = normalizeEmail(String(body.email || ""));
    const username = String(body.username || "").trim();
    if (!email || !email.includes("@")) throw new Error("A valid email address is required.");
    if (username.length < 3) throw new Error("Username must be at least 3 characters long.");

    const since = new Date(Date.now() - 60_000).toISOString();
    const { data: recent } = await admin
      .from("customer_email_otps")
      .select("id")
      .eq("email", email)
      .eq("purpose", "register")
      .gte("created_at", since)
      .maybeSingle();
    if (recent) throw new Error("Please wait at least 60 seconds before requesting another code.");

    const otp = generateOtp();
    const codeHash = await sha256(`${email}:${otp}:${otpPepper}`);
    await admin.from("customer_email_otps").update({ used_at: new Date().toISOString() }).eq("email", email).eq("purpose", "register").is("used_at", null);

    const { error } = await admin.from("customer_email_otps").insert({
      email,
      username,
      purpose: "register",
      code_hash: codeHash,
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    if (error) throw error;

    await sendOtpEmail(email, otp);
    return new Response(JSON.stringify({ success: true, message: "OTP sent successfully." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unable to send OTP." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
