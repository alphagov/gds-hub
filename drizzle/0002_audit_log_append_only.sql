-- audit_log is append-only: rows can be added but never changed or removed,
-- whichever code path or query tries. Dropping the whole schema or database
-- (db:reset, test clean-up) still works, because that doesn't run row or
-- TRUNCATE triggers.
--
-- Hand-written, like 0001_search.sql. Removing old entries for a retention
-- policy needs a deliberate step by the table owner that disables these
-- triggers.

CREATE FUNCTION "audit_log_reject_change"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP
    USING HINT = 'Record a new audit entry instead of changing an old one.';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_log_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_reject_change"();
--> statement-breakpoint
CREATE TRIGGER "audit_log_no_truncate"
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_reject_change"();
