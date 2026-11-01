-- A call that buys something (a billable console tool): the console's quote
-- for it, shown on the approval card. Non-null means the user has to confirm
-- the purchase explicitly (`confirm_purchase`), and "approve all" never
-- covers it.
alter table approval_checks add column purchase jsonb;
