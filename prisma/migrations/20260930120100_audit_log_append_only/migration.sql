-- AuditLog is append-only at the database level.
-- DELETE is always rejected. UPDATE is rejected unless the only change is
-- "actorId" being set to NULL (needed by ON DELETE SET NULL when a user is purged).
CREATE OR REPLACE FUNCTION audit_log_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AuditLog is append-only: DELETE is not allowed';
  END IF;
  IF (to_jsonb(NEW) - 'actorId') IS DISTINCT FROM (to_jsonb(OLD) - 'actorId')
     OR NEW."actorId" IS NOT NULL THEN
    RAISE EXCEPTION 'AuditLog is append-only: UPDATE is not allowed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION audit_log_guard();
