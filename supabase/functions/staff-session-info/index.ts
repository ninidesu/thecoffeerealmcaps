import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const locationCache = new Map<string, { city: string | null; region: string | null; countryCode: string | null; expiresAt: number }>();

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function requestIp(request: Request) {
  const candidate = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]
    || "";
  return candidate.trim().replace(/^::ffff:/, "") || null;
}

async function approximateLocation(ip: string) {
  const cached = locationCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached;

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,city,region,country_code`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) throw new Error("Location service unavailable");
    const data = await response.json();
    const result = {
      city: data?.success && data?.city ? String(data.city) : null,
      region: data?.success && data?.region ? String(data.region) : null,
      countryCode: data?.success && data?.country_code ? String(data.country_code) : null,
      expiresAt: Date.now() + 30 * 60 * 1000,
    };
    locationCache.set(ip, result);
    return result;
  } catch {
    return { city: null, region: null, countryCode: null, expiresAt: Date.now() + 60 * 1000 };
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "Session information is unavailable." }, 500);

  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Authentication required." }, 401);

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "Authentication required." }, 401);

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError) return json({ error: "Session information is unavailable." }, 500);

  const role = String(profile?.role || "").trim().toLowerCase().replace(/[ -]+/g, "_");
  if (!["staff", "operational_staff", "operations_staff", "operation_staff"].includes(role)) return json({ error: "Staff access required." }, 403);

  const ip = requestIp(request);
  if (!ip) return json({ ip: null, city: null, region: null, countryCode: null, approximate: true });
  const location = await approximateLocation(ip);
  return json({ ip, city: location.city, region: location.region, countryCode: location.countryCode, approximate: true });
});
