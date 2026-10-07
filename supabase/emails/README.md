# Account emails

Branded versions of the emails Supabase sends. In Supabase: Authentication > Emails, open each template, set the subject, and paste the file as the message body.

| Template             | File                  | Subject                                                                      |
| -------------------- | --------------------- | ---------------------------------------------------------------------------- |
| Confirm signup       | `confirm-signup.html` | Confirm your email · Confirme su correo · Confirme seu e-mail                |
| Reset password       | `reset-password.html` | Reset your password · Restablezca su contraseña · Redefina sua senha         |
| Change email address | `change-email.html`   | Confirm your new email · Confirme su nuevo correo · Confirme seu novo e-mail |

Each email is written in English, Spanish and Brazilian Portuguese; the one shown follows the language the account signed up in (`lang` in the user's metadata, set by `js/account.js`). Accounts without it get English.
