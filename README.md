# The Coffee Realm — React + Vite rebuild

A clean front-end rebuild of the legacy CoffeeRealm system. The legacy repository was used only to understand its visual identity, pages, and workflows. This project contains no PHP or MySQL code.

## Included routes

| Route | Experience |
|---|---|
| `/` | Public landing page and brand story |
| `/menu` | Searchable customer menu with working cart interactions |
| `/orders` | Customer order history and live status timeline |
| /portal | Shared role-based login for admin, operational staff, and cashier |
| /cashier | Point-of-sale and online queue workspace |
| `/staff` | Staff sales and operations dashboard |
| `/admin` | Admin business and inventory dashboard |

Nested staff and admin URLs currently reuse their role dashboard shell, ready for feature pages to be added independently.

## Run locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and add Supabase values when available.
3. Run `npm run dev`.
4. Create a production build with `npm run build`.

If Supabase variables are absent, the app safely uses local sample data.

## Structure

```text
src/
  components/   shared brand, shell, metric, and status UI
  data/         temporary typed data boundary for prototype content
  lib/          optional Supabase client
  pages/        route-level React components
  App.jsx       routing
  styles.css    shared visual system and responsive behavior
```

See [MIGRATION_BLUEPRINT.md](./MIGRATION_BLUEPRINT.md) for the page inventory, UI/data requirements, and recommended Supabase schema.

