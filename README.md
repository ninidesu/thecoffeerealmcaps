# thecoffeerealmcaps

A clean React + Vite + Supabase rebuild of the legacy CoffeeRealm system. The legacy repository was used only to understand its visual identity, pages, and workflows. This project contains no PHP or MySQL code.

## Supabase connection

This project includes the public Supabase project URL and anon key fallback in `src/lib/supabase.js`, so a fresh clone can connect to the existing Supabase project immediately after `npm install`.

Private backend secrets, such as service-role keys, SMTP passwords, and Resend keys, are not committed. Add those in Supabase Edge Function secrets when deploying backend functions.

## Included routes

| Route | Experience |
|---|---|
| `/` | Public landing page and brand story |
| `/login` | Customer login, registration, OTP verification, and password reset |
| `/portal` | Shared role-based login for admin, operational staff, and cashier |
| `/cashier` | Walk-in POS workspace |
| `/staff` | Staff sales and operations dashboard |
| `/admin` | Admin business and inventory dashboard |

Nested staff and admin URLs currently reuse their role dashboard shell, ready for feature pages to be added independently.

## Run locally

1. Install dependencies with `npm install`.
2. Run `npm run dev`.
3. Open the local Vite URL, usually `http://127.0.0.1:5173/`.
4. Create a production build with `npm run build`.

Optional: copy `.env.example` to `.env` only if you want to override the built-in public Supabase URL/anon key.

## Structure

```text
src/
  components/   shared brand, shell, metric, and status UI
  data/         temporary landing-page and dashboard prototype content
  lib/          Supabase client
  pages/        route-level React components
  App.jsx       routing
  styles.css    shared visual system and responsive behavior
supabase/
  *.sql         setup/seed SQL files
  functions/    Supabase Edge Functions
```

See [MIGRATION_BLUEPRINT.md](./MIGRATION_BLUEPRINT.md) for the page inventory, UI/data requirements, and recommended Supabase schema.
