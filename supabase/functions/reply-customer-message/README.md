# Customer message reply email

Deploy with `supabase functions deploy reply-customer-message`. The function uses the same secrets as the order email function: `GMAIL_SMTP_USER`, `GMAIL_SMTP_APP_PASSWORD`, optional `MAIL_FROM_NAME`, `STORE_NAME`, and `MAIL_BANNER_IMAGE`.

Only authenticated admin, staff, or operational-staff profiles can send replies. A message is marked replied only after Gmail SMTP accepts the email.
