# Sales Reports Page Override

This page follows the Coffee Realm management workspace theme in `src/management-theme.css`. These rules override the general storefront-oriented guidance in `MASTER.md` for `/admin/reports`.

## Design Read

Internal analytics dashboard for Coffee Realm administrators. Preserve the existing information architecture, green management palette, Lucide icon system, live Supabase data, saved session filters, and export workflows.

## Design Dials

- Variance: 4/10
- Motion: 2/10
- Density: 7/10

## Layout

- Lead with one prominent Net Revenue metric and three supporting metrics.
- Show financial reconciliation directly below the overview.
- Use progressive disclosure for custom dates and secondary filters.
- Keep the revenue trend full width.
- Use an asymmetric breakdown grid: status distribution on the left, payment and order type summaries on the right.
- Desktop uses data tables. Below 760px, transaction rows become stacked cards.

## Visual Tokens

- Use the semantic `--mgmt-*` variables. Do not introduce a separate analytics palette.
- Primary actions and current-period data use `--mgmt-primary`.
- Gold is reserved for warnings and average-value emphasis.
- Red is reserved for cancellations, refunds, and errors.
- Cards and panels use 14px radii. Controls use 9-10px radii. Pills are limited to statuses.
- Numeric data uses tabular figures.

## Interaction and Accessibility

- Interactive controls are at least 40px on desktop and 44px on small screens where practical.
- Charts have visible legends, keyboard-reachable data points, text summaries, and tabular alternatives.
- Sortable table headers expose `aria-sort`.
- The order-detail dialog traps focus, closes with Escape, and restores focus to its trigger.
- All loading, error, empty, truncated-data, and reduced-motion states must remain usable.

## Responsive Targets

- 1440px: complete analytics composition.
- 1024px: stacked overview and single-column breakdowns.
- 768px: wrapped filters and simplified chart controls.
- 375px: mobile transaction cards, two-column reconciliation, and no page-level horizontal scrolling.
