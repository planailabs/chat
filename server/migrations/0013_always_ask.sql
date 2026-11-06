-- Calls on the always-ask list ([approval].always_ask) are put to the user
-- without the validator: recorded with the verdict 'always'.
ALTER TABLE approval_checks DROP CONSTRAINT approval_checks_check_verdict_check;
ALTER TABLE approval_checks ADD CONSTRAINT approval_checks_check_verdict_check CHECK (check_verdict IN ('approved', 'rejected', 'failed', 'always'));
