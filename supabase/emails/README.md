# Account emails

Branded versions of the emails Supabase sends. In Supabase: Authentication > Emails, open each template, set the subject, and paste the file as the message body.

| Template             | File                  | Subject                                                                      |
| -------------------- | --------------------- | ---------------------------------------------------------------------------- |
| Confirm signup       | `confirm-signup.html` | Confirm your email · Confirme su correo · Confirme seu e-mail                |
| Reset password       | `reset-password.html` | Reset your password · Restablezca su contraseña · Redefina sua senha         |
| Change email address | `change-email.html`   | Confirm your new email · Confirme su nuevo correo · Confirme seu novo e-mail |

Each email is written in English, Spanish and Brazilian Portuguese; the one shown follows the language the account signed up in (`lang` in the user's metadata, set by `js/account.js`). Accounts without it get English.

Each file starts with a small `<style>` block for dark-mode mail clients (`prefers-color-scheme: dark`): the card turns navy with light text, and the button keeps its blue. Mail clients that strip styles (Gmail) keep the light version, which reads either way. After changing a file, paste the whole file into Supabase again; the templates don't update themselves.
