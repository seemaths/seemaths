-- Seven-day assignment labels: 0000–9999. UUID links and progress stay unchanged.
DO $migration$
DECLARE
    item RECORD;
    candidate INTEGER;
BEGIN
    PERFORM pg_advisory_xact_lock(742001);
    FOR item IN SELECT id, reference FROM assignments_portal.assignments WHERE length(reference)<>4 ORDER BY created_at,id FOR UPDATE LOOP
        candidate := right(item.reference,4)::integer;
        WHILE EXISTS (SELECT 1 FROM assignments_portal.assignments WHERE reference=lpad(candidate::text,4,'0')) LOOP
            candidate := (candidate+1)%10000;
        END LOOP;
        UPDATE assignments_portal.assignments SET reference=lpad(candidate::text,4,'0') WHERE id=item.id;
    END LOOP;
END;
$migration$;
ALTER TABLE assignments_portal.assignments DROP CONSTRAINT IF EXISTS assignments_reference_four_digits;
ALTER TABLE assignments_portal.assignments ADD CONSTRAINT assignments_reference_four_digits CHECK (reference ~ '^[0-9]{4}$');
