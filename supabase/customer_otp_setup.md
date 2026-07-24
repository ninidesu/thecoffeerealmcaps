# CoffeeRealm custom 6-digit customer OTP setup

This replaces Supabase's built-in signup confirmation email with the old CoffeeRealm-style 6-digit OTP flow.

## What this does

1. Customer fills out registration form.
2. React calls `request-customer-otp`.
3. The Edge Function generates a 6-digit OTP and sends the CoffeeRealm email template.
4. Customer enters the OTP.
5. React calls `verify-customer-otp` with the OTP and pending account details.
6. The Edge Function verifies the OTP and creates a confirmed Supabase Auth customer account.
7. React logs the customer in.

## 1. Run SQL

Open Supabase SQL Editor and run:

```text
supabase/customer_otp_schema.sql
```

## 2. Add Edge Function secrets

In Supabase Dashboard > Edge Functions > Secrets, add:

```text
RESEND_API_KEY=your_resend_api_key
MAIL_FROM_EMAIL=your_verified_sender_email
MAIL_FROM_NAME=the coffee realm
OTP_PEPPER=any-long-random-secret-string
```

Supabase automatically provides these to deployed functions:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Optional:

```text
MAIL_BANNER_IMAGE=https://res.cloudinary.com/dkpdilkin/image/upload/f_auto,q_auto,w_1200/emailbg_miswbo.jpg
```

## 3. Deploy functions

```bash
supabase functions deploy request-customer-otp
supabase functions deploy verify-customer-otp
```

## 4. Supabase Auth setting

Because CoffeeRealm now handles signup OTP, you can turn off Supabase Auth email confirmation if you do not want duplicate Supabase signup emails:

```text
Authentication > Providers > Email > Confirm email: OFF
```

The custom function still creates the user as email-confirmed only after the 6-digit CoffeeRealm OTP is verified.

## Important

Do not expose `SUPABASE_SERVICE_ROLE_KEY` in React. It belongs only in Supabase Edge Function secrets.
