-- A customer waiting for a manager's decision has no owner (nobody may quote it).
UPDATE "customer" SET "ownerId" = NULL WHERE "status" = 'PENDING_OWNER' AND "ownerId" IS NOT NULL;
ALTER TABLE "customer" ADD CONSTRAINT "customer_pending_no_owner_check" CHECK ("status" <> 'PENDING_OWNER' OR "ownerId" IS NULL);
