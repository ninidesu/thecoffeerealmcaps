import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const otpPepper = Deno.env.get("OTP_PEPPER") || "";

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const normalizeEmail = (email: string) => email.trim().toLowerCase();

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ success: false, error: "Use POST." }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    if (!supabaseUrl || !serviceRoleKey || !otpPepper) throw new Error("Supabase service credentials and OTP_PEPPER must be configured.");
    const body = await req.json();
    const email = normalizeEmail(String(body.email || ""));
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const otp = String(body.otp || "").replace(/\D/g, "");

    if (!email || !email.includes("@")) throw new Error("A valid email address is required.");
    if (username.length < 3) throw new Error("Username must be at least 3 characters long.");
    if (password.length < 6 || !/\d/.test(password)) throw new Error("Password must be at least 6 characters and include at least 1 number.");
    if (!/^\d{6}$/.test(otp)) throw new Error("OTP must be exactly 6 digits.");

    const { data: row, error: rowError } = await admin
      .from("customer_email_otps")
      .select("id,email,username,code_hash,expires_at,attempt_count,blocked_until,used_at")
      .eq("email", email)
      .eq("purpose", "register")
      .is("used_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (rowError) throw rowError;
    if (!row) throw new Error("Invalid or expired OTP.");

    if (row.blocked_until && new Date(row.blocked_until).getTime() > Date.now()) {
      throw new Error("Please try again later.");
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await admin.from("customer_email_otps").update({ used_at: new Date().toISOString() }).eq("id", row.id);
      throw new Error("Invalid or expired OTP.");
    }

    const codeHash = await sha256(`${email}:${otp}:${otpPepper}`);
    if (codeHash !== row.code_hash) {
      const attemptCount = Number(row.attempt_count || 0) + 1;
      const blockedUntil = attemptCount >= 5 ? new Date(Date.now() + 10 * 60_000).toISOString() : null;
      await admin
        .from("customer_email_otps")
        .update({ attempt_count: attemptCount, blocked_until: blockedUntil, used_at: blockedUntil ? new Date().toISOString() : null })
        .eq("id", row.id);
      throw new Error(blockedUntil ? "Too many incorrect attempts. Please request a new code later." : "Invalid OTP. Please try again.");
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, role: "customer" },
    });

    if (createError) {
      if (/already|registered|exists/i.test(createError.message)) {
        throw new Error("This email is already registered. Please log in instead.");
      }
      throw createError;
    }

    await admin.from("customer_email_otps").update({ used_at: new Date().toISOString() }).eq("id", row.id);

    return new Response(JSON.stringify({ success: true, user_id: created.user?.id || null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unable to verify OTP." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
