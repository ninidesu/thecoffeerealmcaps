# Cancellation and refund email dispatcher

This Edge Function sends durable email events from `public.order_email_outbox`.
Cancellation and refund RPCs write the business change and email event in the
same database transaction. The browser invokes this function for immediate
delivery. Failed delivery remains in the outbox for a later retry.
The outbox claim prevents two workers from sending the same pending event at
the same time and preserves failed events for controlled retries.

## Required secrets

The function sends through the CoffeeRealm Gmail account. Use a dedicated
Google App Password for the Edge Functions even if the same Gmail account is
already configured under Supabase Auth SMTP:

```bash
supabase secrets set GMAIL_SMTP_USER="your-gmail-address@gmail.com"
supabase secrets set GMAIL_SMTP_APP_PASSWORD="your_16_character_google_app_password"
supabase secrets set MAIL_FROM_NAME="thecoffeerealm"
supabase secrets set STORE_CONTACT="+63 997 533 7958"
```

Supabase Auth SMTP and Edge Function secrets are separate. Supabase does not
expose the Auth SMTP password to custom functions, so the Gmail credentials
must also be saved as Edge Function secrets. Never put the app password in the
frontend or commit it to this repository.

The cancellation messages use the same banner, card, typography, colors, and
store footer as `send-order-email`. These optional secrets override the shared
template defaults when the store details change:

```bash
supabase secrets set STORE_NAME="thecoffeerealm"
supabase secrets set STORE_ADDRESS="Lot 1 Block 210 Mark Street corner Dollar Street, Quezon City"
supabase secrets set MAIL_BANNER_IMAGE="https://your-image-host/email-banner.jpg"
```

Gmail delivery uses `smtp.gmail.com` over TLS port 465. `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
provided automatically by Supabase Edge Functions.

## Deploy

```bash
supabase functions deploy process-order-email-outbox
```

For the currently linked CoffeeRealm project, do not run a blanket `supabase
db push` until its migration history has been reconciled. Apply only
`supabase/migrations/20260809130000_cancellation_refund_email_workflow.sql`
through the Supabase SQL Editor, then deploy this function.

## Automatic retry

Production retries are installed by
`20260809150000_order_email_outbox_retry_cron.sql`. It schedules a POST request
every minute with the service-role authorization header and this JSON body:

```json
{ "dispatch_pending": true }
```

Target URL:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/process-order-email-outbox
```

The migration reads the credential from the Supabase Vault secret named
`order_email_dispatch_service_role`. Never place the service-role key in
frontend code or directly inside the migration file.
