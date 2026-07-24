# CoffeeRealm migration blueprint

## Product map

The legacy application serves four connected audiences:

1. Customers discover the café, browse the menu, order, pay, track orders, manage addresses/profile details, and request support.
2. Cashiers handle walk-in sales, review the online queue, collect payments, issue receipts, and communicate with customers.
3. Staff prepare orders, manage the menu and supplies, and review operating reports.
4. Administrators manage accounts, inventory, settings, transaction history, and business performance.

The rebuild organizes those workflows by domain instead of mirroring the legacy file layout. Shared components, role shells, and one Supabase data layer can support each feature without mixing presentation and server concerns.

## Page and feature inventory

### Public landing (`/`)

- **Purpose:** Introduce the brand and convert visitors into customers.
- **UI sections:** navigation, editorial hero, trust strip, featured menu cards, brand story and values, location callout, footer.
- **Required data:** active branch, opening hours, featured products, testimonials, landing content, store contact details.
- **React implementation:** `HomePage`, `Brand`, and reusable product-card rendering.
- **Supabase sources:** `branches`, `store_hours`, `products`, `product_variants`, `site_content`, `testimonials`.

### Menu and cart (`/menu`)

- **Purpose:** Let customers search, filter, customize, and add available items before checkout.
- **UI sections:** customer navigation, page introduction, search, categories, menu grid, persistent order cart.
- **Required data:** category hierarchy, product name/description/image, active variants, price, availability, modifiers, branch stock state.
- **React implementation:** `MenuPage` with search, category filtering, add/remove, quantity updates, and calculated subtotal.
- **Supabase sources:** `categories`, `products`, `product_variants`, `modifier_groups`, `modifiers`, `branch_product_availability`, `carts`, `cart_items`.

### Checkout (next route: `/checkout`)

- **Purpose:** Capture fulfillment, address, contact, payment method, proof if necessary, and final consent.
- **UI sections:** fulfillment selector, saved/new address, schedule, payment options, order summary, confirmation, processing/success states.
- **Required data:** authenticated profile, addresses, branch schedule, delivery limits/fees, cart and modifiers, payment methods, order settings.
- **Recommended React components:** `CheckoutPage`, `FulfillmentPicker`, `AddressPicker`, `PaymentMethodPicker`, `OrderSummary`.
- **Supabase sources:** `profiles`, `customer_addresses`, `store_hours`, `carts`, `cart_items`, `payment_methods`, `orders`, `order_items`, `payments`.

### My orders (`/orders`)

- **Purpose:** Show active and historical orders, status progress, receipt details, cancellation/reorder, and feedback.
- **UI sections:** current/past tabs, order cards, fulfillment timeline, address and item summary, receipt/help actions.
- **Required data:** customer orders, ordered item snapshots, status history, fulfillment details, payments, cancellations, feedback.
- **React implementation:** `OrdersPage` and status timeline.
- **Supabase sources:** `orders`, `order_items`, `order_status_events`, `payments`, `order_cancellations`, `order_feedback`.

### Customer account (next routes: `/profile`, `/help`, `/about`)

- **Purpose:** Manage identity, profile image, saved addresses and security; provide business information and support.
- **UI sections:** profile form, avatar, address cards, password/security actions, cart shortcut, FAQ/contact form.
- **Required data:** auth user, profile, addresses, support threads/messages, public business content.
- **Recommended React components:** `ProfilePage`, `ProfileForm`, `AddressBook`, `SecurityPanel`, `HelpPage`, `AboutPage`.
- **Supabase sources:** Supabase Auth, `profiles`, `customer_addresses`, `support_threads`, `support_messages`, `site_content`.

### Cashier POS (`/cashier`)

- **Purpose:** Process walk-in transactions while monitoring and acting on online orders.
- **UI sections:** register header, product/category browser, live ticket, customer field, totals/payment, online queue, transaction lookup.
- **Required data:** open register/shift, available products and modifiers, tax/settings, online queue, payment records, receipt numbers.
- **React implementation:** `CashierPage` with a working product-to-ticket flow.
- **Supabase sources:** `registers`, `cashier_shifts`, `products`, `product_variants`, `orders`, `order_items`, `payments`, `receipts`.

### Staff workspace (`/staff`)

- **Purpose:** Give staff an operational view and access to order preparation, menu, supply, transaction, and reporting features.
- **UI sections:** role sidebar, daily metrics, hourly sales, best sellers, live order list.
- **React implementation:** `AppShell`, `StaffDashboard`, `MetricCard`, `StatusPill`.

Feature extensions:

| Feature | Purpose and UI | Data |
|---|---|---|
| Order preparation | Kanban/queue, order detail, status actions, cancellation note, delivery link | `orders`, `order_items`, `order_status_events`, `order_cancellations` |
| Menu management | Product table/cards, add/edit item, image, category and modifier management | `categories`, `products`, `product_variants`, `modifier_groups`, `modifiers` |
| Supply orders | quick actions, request form, receive stock, restock history | `suppliers`, `supply_orders`, `supply_order_items`, `inventory_movements` |
| Transactions | filterable list and detail drawer | `orders`, `payments`, `receipts` |
| Reports | daily sales, item mix, peak hours, ingredient usage | database views over orders/items/movements |

### Admin workspace (`/admin`)

- **Purpose:** Provide ownership-level monitoring and system control.
- **UI sections:** role sidebar, revenue/order/customer/stock metrics, trend chart, stock health, recent transactions.
- **React implementation:** `AppShell`, `AdminDashboard`, shared dashboard primitives.

Feature extensions:

| Feature | Purpose and UI | Data |
|---|---|---|
| Inventory | stock filters, unit levels, thresholds, recent deductions | `ingredients`, `branch_inventory`, `inventory_movements`, `recipes` |
| Team/accounts | create, activate, deactivate, and assign staff/cashier/admin roles | Auth, `profiles`, `user_roles`, `branch_assignments` |
| Reports | day/week/month sales, product performance, cancellations, export | reporting views, `orders`, `order_items`, `payments`, `order_cancellations` |
| Audit trail | actor, action, target, timestamp, metadata | `audit_events` |
| Settings | store info/schedule, ordering, payments, branding, password/session rules | `branches`, `store_hours`, `app_settings`, `payment_methods` |

## Recommended Supabase schema

Use `uuid` primary keys, `timestamptz` timestamps, `numeric(12,2)` for money, and generated `created_at`/`updated_at` values unless noted.

### Identity and access

- **profiles:** `id` (references `auth.users`), `full_name`, `phone`, `avatar_path`, `status`, timestamps.
- **user_roles:** `user_id`, `role` (`customer`, `cashier`, `staff`, `admin`), `branch_id`, `is_active`, unique per user/role/branch.
- **customer_addresses:** `id`, `customer_id`, `label`, `recipient_name`, `phone`, `address_line_1`, `address_line_2`, `barangay`, `city`, `province`, `postal_code`, `latitude`, `longitude`, `delivery_notes`, `is_default`.
- **branch_assignments:** `user_id`, `branch_id`, `job_title`, `started_at`, `ended_at`.

### Store and content

- **branches:** `id`, `name`, `slug`, `address`, `phone`, `email`, `latitude`, `longitude`, `timezone`, `is_active`.
- **store_hours:** `id`, `branch_id`, `day_of_week`, `opens_at`, `closes_at`, `is_closed`.
- **site_content:** `id`, `content_key`, `title`, `body`, `image_path`, `metadata` (`jsonb`), `is_published`.
- **testimonials:** `id`, `reviewer_name`, `avatar_path`, `quote`, `rating`, `sort_order`, `is_published`.
- **app_settings:** `key`, `value` (`jsonb`), `branch_id` nullable, `is_secret` false for client-readable settings.

### Catalog

- **categories:** `id`, `parent_id` nullable, `name`, `slug`, `description`, `sort_order`, `is_active`.
- **products:** `id`, `category_id`, `name`, `slug`, `description`, `image_path`, `is_featured`, `is_active`.
- **product_variants:** `id`, `product_id`, `name`, `sku`, `price`, `cost`, `is_default`, `is_active`.
- **modifier_groups:** `id`, `name`, `min_select`, `max_select`, `is_required`.
- **product_modifier_groups:** `product_id`, `modifier_group_id`, `sort_order`.
- **modifiers:** `id`, `modifier_group_id`, `name`, `price_delta`, `is_active`.
- **branch_product_availability:** `branch_id`, `product_id`, `is_available`, `unavailable_reason`, `available_from`, `available_until`.

### Cart and ordering

- **carts:** `id`, `customer_id` nullable, `session_key` nullable, `branch_id`, `status`, `expires_at`.
- **cart_items:** `id`, `cart_id`, `product_variant_id`, `quantity`, `unit_price`, `notes`.
- **cart_item_modifiers:** `cart_item_id`, `modifier_id`, `unit_price_delta`.
- **orders:** `id`, `order_number`, `customer_id` nullable, `branch_id`, `cashier_id` nullable, `channel`, `fulfillment_type`, `status`, `subtotal`, `discount_total`, `delivery_fee`, `tax_total`, `grand_total`, `currency`, `customer_name_snapshot`, `customer_phone_snapshot`, `delivery_address_snapshot` (`jsonb`), `scheduled_for`, `placed_at`, timestamps.
- **order_items:** `id`, `order_id`, `product_id` nullable, `product_variant_id` nullable, `product_name_snapshot`, `variant_name_snapshot`, `quantity`, `unit_price`, `line_total`, `notes`.
- **order_item_modifiers:** `id`, `order_item_id`, `modifier_name_snapshot`, `unit_price_delta`.
- **order_status_events:** `id`, `order_id`, `from_status`, `to_status`, `changed_by`, `note`, `created_at`.
- **order_cancellations:** `id`, `order_id`, `requested_by`, `reason_code`, `reason_text`, `decision`, `decided_by`, `decided_at`.
- **order_feedback:** `id`, `order_id`, `customer_id`, `rating`, `comment`, `created_at`, unique on order.

### Payments and receipts

- **payment_methods:** `id`, `branch_id` nullable, `code`, `display_name`, `instructions`, `configuration` (`jsonb`, server-only), `is_active`.
- **payments:** `id`, `order_id`, `method_id`, `provider_reference`, `amount`, `status`, `proof_path`, `paid_at`, `recorded_by`, `metadata` (`jsonb`).
- **receipts:** `id`, `order_id`, `receipt_number`, `issued_at`, `issued_by`, `snapshot` (`jsonb`).
- **cashier_shifts:** `id`, `cashier_id`, `register_id`, `opened_at`, `closed_at`, `opening_cash`, `closing_cash`, `status`.
- **registers:** `id`, `branch_id`, `name`, `code`, `is_active`.

### Inventory and supply

- **ingredients:** `id`, `name`, `sku`, `base_unit`, `reorder_level`, `is_active`.
- **recipes:** `product_variant_id`, `ingredient_id`, `quantity`.
- **branch_inventory:** `branch_id`, `ingredient_id`, `quantity_on_hand`, `last_counted_at`, unique on branch/ingredient.
- **inventory_movements:** `id`, `branch_id`, `ingredient_id`, `movement_type`, `quantity_delta`, `source_type`, `source_id`, `notes`, `created_by`, `created_at`.
- **suppliers:** `id`, `name`, `contact_name`, `phone`, `email`, `address`, `is_active`.
- **supply_orders:** `id`, `supplier_id`, `branch_id`, `status`, `ordered_by`, `ordered_at`, `expected_at`, `received_at`, `total_cost`.
- **supply_order_items:** `id`, `supply_order_id`, `ingredient_id`, `quantity_ordered`, `quantity_received`, `unit_cost`.

### Support and governance

- **support_threads:** `id`, `customer_id`, `order_id` nullable, `subject`, `status`, timestamps.
- **support_messages:** `id`, `thread_id`, `sender_id`, `body`, `read_at`, `created_at`.
- **audit_events:** `id`, `actor_id`, `action`, `entity_type`, `entity_id`, `before_data` (`jsonb`), `after_data` (`jsonb`), `ip_hash`, `created_at`.

## Supabase integration approach

- Keep the client creation isolated in `src/lib/supabase.js`.
- Add one query module per domain (`catalog`, `orders`, `inventory`, `reports`) rather than querying from UI components.
- Use Supabase Auth for identity and Row Level Security for every user-owned or role-sensitive table.
- Customers may read/update only their own profile, addresses, carts, orders, feedback, and support threads.
- Cashiers and staff should access only assigned branches. Admin access should be explicit through `user_roles`, never inferred from client state.
- Use database functions or trusted server functions for checkout, stock deduction, order-number generation, payment verification, and role changes.
- Store menu/product/profile images and payment proof in separate Storage buckets with bucket-specific policies.
- Use Realtime selectively for order queue/status and support messages; reports should use indexed views or materialized summaries.

## Implementation sequence

1. Add Auth, profiles, roles, branches, and RLS.
2. Replace sample catalog data with Supabase catalog queries.
3. Persist carts and implement the atomic checkout function.
4. Connect order tracking and staff/cashier realtime queues.
5. Add payment proof and receipt storage.
6. Implement recipes, inventory movements, and supply ordering.
7. Add reporting views, settings, audit events, and exports.
