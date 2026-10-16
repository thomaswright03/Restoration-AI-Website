# Live check: Stripe, Supabase and the kill switch (test mode)

A by-hand run of the money and database paths against the live site
(https://restoration-ai-website-nu.vercel.app) with Stripe in **Test mode**.
No real card is charged. Log each run below with its date, who ran it, and
what happened at each step.

Before starting: Vercel's `STRIPE_SECRET_KEY` begins `sk_test_`, and
`supabase/schema.sql` has been re-run (it adds `used_trials`).

Use a fresh test email for the new account, e.g. `you+check1@gmail.com`
(Gmail delivers +aliases to the same inbox). Card: `4242 4242 4242 4242`,
any future date, any CVC.

## Steps

1. **Sign up** a new account with the test email; confirm it from the email; log in.
2. **Buy a plan with a promo code**: Account page, type `FREEWEEK`, pick Starter, pay with the test card.
   Expect: back on the account page, the plan card says Starter, free until a date 7 days out.
   Supabase > Table Editor > `subscriptions`: a row for the account, `status` = `trialing`, `plan` = `starter`.
   Stripe > Customers: the customer with a trialing subscription.
3. **Save a project** in the designer (the save bar shows the plan's allowance). Expect it on My projects.
4. **Kill switch, checkout**: Supabase `site_switches` row 1, set `checkout` = false, `notice` = "Live check".
   Wait 15 s, reload the account page. Expect "buying a plan is paused" with the notice, no buy buttons.
5. **Kill switch, saving**: set `saving` = false. Reload the designer. Expect the save bar to say saving is paused.
6. **Kill switch, sign-ups**: set `signups` = false. Open the sign-up page in a private window. Expect "New sign-ups are paused".
   Set all three back to true and `notice` to empty. Expect everything back within 15 s.
7. **Cancel**: Account page > Manage billing > cancel the plan. Expect the plan card to say it ends on the trial's end date
   (`cancel_at_period_end` = true in `subscriptions`).
8. **Delete the account**: Account page > Delete account, type the email. Expect: signed out; the account's rows are gone
   from `businesses`, `subscriptions` and `projects`; `used_trials` has one new row (a hash, no email).
9. **One free trial per email**: sign up again with the same test email, type `FREEWEEK`, pick a plan.
   Expect: refused with "this account, or an earlier one with this email, has had one before". Without the code,
   checkout opens with no free days (close it without paying). Then delete this account too.

## Log

| Date (UTC) | Ran by | Steps passed | Notes / failures |
| ---------- | ------ | ------------ | ---------------- |
