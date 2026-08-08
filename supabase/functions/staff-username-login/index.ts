import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const authClient = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ success: false, error: "Use POST." }, 405);
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ success: false, error: "Login service is unavailable." }, 500);

  try {
    const body = await request.json();
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");
    if (!username || !password || username.length > 32) return json({ success: false, error: "Invalid email, username, or password." });

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("email, role")
      .ilike("username", username.replace(/[%,_]/g, "\\$&"))
      .maybeSingle();

    if (profileError) throw profileError;
    const normalizedRole = String(profile?.role || "").trim().toLowerCase().replace(/[ -]+/g, "_");
    const isStaff = ["staff", "operational_staff", "operations_staff", "operation_staff"].includes(normalizedRole);
    const loginEmail = isStaff && profile?.email ? profile.email : "invalid-staff-login@invalid.local";
    const { data, error } = await authClient.auth.signInWithPassword({ email: loginEmail, password });

    if (error || !isStaff || !data.session) return json({ success: false, error: "Invalid email, username, or password." });
    return json({
      success: true,
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    });
  } catch {
    return json({ success: false, error: "Unable to complete staff sign-in." }, 500);
  }
});
