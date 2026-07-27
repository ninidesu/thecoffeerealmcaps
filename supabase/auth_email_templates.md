# thecoffeerealm Supabase Auth email templates

Use these in Supabase Dashboard > Authentication > Emails.
Important:

- SMTP settings only control who sends the email.
- Templates control what the email looks like.
- To get an OTP instead of a link, paste the Confirm signup HTML below into the Confirm signup template, not the Magic Link template.
- The Confirm signup template must contain {{ .Token }} and should not contain {{ .ConfirmationURL }} if you want OTP-only signup verification.
- The React page is set up for Supabase signup OTP as a 6-digit code. If the email appears to show 7 characters, check that the Confirm signup template only prints {{ .Token }} with no extra number beside it.

These are for account/auth emails only. Order receipts are handled by `supabase/functions/send-order-email`.
Supabase OTP length setting:

If the email shows 8 digits, change the generator setting in Supabase:

```text
Authentication > Sign In / Providers > Email > Email OTP length: 6
```

Do not shorten `{{ .Token }}` in the HTML template. The email must show the full token that Supabase generated, or verification will fail.

## Confirm signup

Paste this under:

```text
Supabase Dashboard > Authentication > Emails > Templates > Confirm signup
```

Subject:

```text
thecoffeerealm - Verify Your Email
```

HTML:

```html
<body style="margin:0;padding:0;background-color:#eef3ef;font-family:Arial,Helvetica,sans-serif;color:#1f2f26;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#eef3ef;margin:0;padding:0;width:100%;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;width:100%;">
          <tr>
            <td style="background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 24px rgba(31,47,38,0.10);">
              <img src="https://res.cloudinary.com/dkpdilkin/image/upload/f_auto,q_auto,w_1200/emailbg_miswbo.jpg" alt="thecoffeerealm Email Banner" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;margin:0;padding:0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="padding:32px 32px 12px;text-align:center;">
                    <div style="font-size:13px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#2f5c46;margin-bottom:10px;">thecoffeerealm</div>
                    <div style="font-size:30px;line-height:38px;font-weight:bold;color:#1b2d22;margin:0;">Verify Your Email</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 32px 8px;text-align:center;font-size:16px;line-height:26px;color:#4f6358;">
                    Thank you for registering with thecoffeerealm. Use the code below to verify your email address.
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:18px 32px 10px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                      <tr>
                        <td align="center" style="background-color:#f4faf3;border:2px dashed #2f5c46;border-radius:16px;padding:16px 28px;">
                          <div style="font-size:12px;line-height:18px;color:#5d6f63;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;">Your Verification Code</div>
                          <div style="font-size:36px;line-height:42px;font-weight:bold;letter-spacing:10px;color:#2f5c46;">{{ .Token }}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 32px 0;text-align:center;font-size:15px;line-height:24px;color:#244735;font-weight:bold;">
                    This code will expire soon.
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 32px 0;text-align:center;font-size:14px;line-height:22px;color:#7a3e00;">
                    Do not share this code with anyone.
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 32px 30px;text-align:center;font-size:13px;line-height:21px;color:#708278;">
                    If you did not request this email, you can safely ignore it.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
```

## Reset password

Subject:

```text
thecoffeerealm - Reset Your Password
```

HTML:

```html
<body style="margin:0;padding:0;background-color:#eef3ef;font-family:Arial,Helvetica,sans-serif;color:#1f2f26;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#eef3ef;margin:0;padding:0;width:100%;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;width:100%;">
          <tr>
            <td style="background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 24px rgba(31,47,38,0.10);">
              <img src="https://res.cloudinary.com/dkpdilkin/image/upload/f_auto,q_auto,w_1200/emailbg_miswbo.jpg" alt="thecoffeerealm Email Banner" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;margin:0;padding:0;">
              <div style="padding:32px 32px 12px;text-align:center;">
                <div style="font-size:13px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#2f5c46;margin-bottom:10px;">thecoffeerealm</div>
                <div style="font-size:30px;line-height:38px;font-weight:bold;color:#1b2d22;margin:0;">Reset Your Password</div>
              </div>
              <div style="padding:0 32px 20px;text-align:center;font-size:16px;line-height:26px;color:#4f6358;">
                We received a request to reset your password. Click the button below to continue.
              </div>
              <div style="padding:8px 32px 20px;text-align:center;">
                <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#2f5c46;color:#ffffff;text-decoration:none;font-weight:bold;border-radius:999px;padding:14px 24px;">Reset Password</a>
              </div>
              <div style="padding:0 32px 30px;text-align:center;font-size:13px;line-height:21px;color:#708278;">
                If you did not request this email, you can safely ignore it.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
```





