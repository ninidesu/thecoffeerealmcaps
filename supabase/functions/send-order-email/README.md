# CoffeeRealm order email function

This Supabase Edge Function sends CoffeeRealm order emails using the old system's email/receipt layout as the reference.

It supports:

- order confirmation email
- completed order email
- receipt email
- receipt HTML attachment

## Why this is separate from Supabase Auth emails

Supabase Auth SMTP is for account emails only, such as sign up confirmation, password reset, and OTP-style auth messages.

Order receipts are business emails. They can include order items, payment details, and receipt attachments, so they belong in a separate server-side function.

## Required Supabase secrets

Set these in Supabase Dashboard → Edge Functions → Secrets, or with the Supabase CLI:

```bash
supabase secrets set RESEND_API_KEY="your_resend_api_key"
supabase secrets set MAIL_FROM_EMAIL="orders@your-domain.com"
supabase secrets set MAIL_FROM_NAME="the coffee realm"
supabase secrets set STORE_NAME="the coffee realm"
supabase secrets set STORE_ADDRESS="Lot 1 Block 210 Mark Street corner Dollar Street, Quezon City"
supabase secrets set STORE_CONTACT="+63 997 533 7958"
```

Optional:

```bash
supabase secrets set MAIL_BANNER_IMAGE="https://res.cloudinary.com/dkpdilkin/image/upload/f_auto,q_auto,w_1200/emailbg_miswbo.jpg"
```

## Deploy

```bash
supabase functions deploy send-order-email
```

## Test payload

```json
{
  "type": "order_completed",
  "to": "customer@example.com",
  "order": {
    "order_number": "WI-002",
    "reference_code": "TCR-20260724-002",
    "customer_name": "Walk-in Customer",
    "order_type_label": "Walk-in",
    "order_date": "July 24, 2026 4:45 PM",
    "payment_method": "GCash",
    "payment_reference": "1234567890123",
    "cashier_name": "Cashier",
    "subtotal": 240,
    "discount": 0,
    "total_amount": 240,
    "items": [
      {
        "name": "Spanish Latte",
        "quantity": 1,
        "subtotal": 240,
        "customizations": {
          "temperature": "Cold",
          "ice": "Default Ice",
          "sugar": "50%"
        },
        "addons": ["Espresso Shot"]
      }
    ]
  }
}
```

## React call example

```js
const { data, error } = await supabase.functions.invoke("send-order-email", {
  body: {
    type: "order_completed",
    to: customerEmail,
    order: orderEmailPayload,
  },
});
```

## Note about Gmail SMTP

Use Gmail SMTP in Supabase Auth for sign up and password reset emails.

For receipt attachments, use this Edge Function with an HTTP email provider such as Resend, Brevo, or SendGrid. This is more reliable for serverless functions than trying to send direct SMTP mail from the edge runtime.
