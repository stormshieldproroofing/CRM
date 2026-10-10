-- Stable keys for expense and deposit rows.
--
-- The CRM used to INSERT a new copy of every expense and deposit on each
-- save, then DELETE the previous copies. That reset created_at and let a
-- stale browser tab wipe rows it had never loaded (and recreate rows another
-- session had deleted). The app now UPDATEs the existing row by primary key
-- and only deletes keys the user removed in that session.
--
-- These unique indexes stop a second physical row from being stored for the
-- same app-level id. Postgres unique indexes still allow multiple NULLs, so
-- legacy rows that have no eid/did are unaffected.
--
-- DO NOT run this until the updated CRM (crm-sync.js + supabase-crm.js) is
-- deployed and every open tab has been refreshed. An old cached page still
-- inserts a new row per save. After this index exists those inserts fail
-- instead of duplicating, and that old page will not delete the previous
-- rows when the insert fails — but those saves will error until the tab
-- loads the new code.
--
-- Safe to re-run.

-- Keep the newest row when the old delete-then-insert bug left two rows
-- with the same eid. (created_at DESC, then id DESC.)
DELETE FROM public.expenses
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           row_number() OVER (
             PARTITION BY eid
             ORDER BY created_at DESC NULLS LAST, id DESC
           ) AS rn
    FROM public.expenses
    WHERE eid IS NOT NULL
  ) ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS expenses_eid_key ON public.expenses (eid);

DELETE FROM public.deposits
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           row_number() OVER (
             PARTITION BY did
             ORDER BY created_at DESC NULLS LAST, id DESC
           ) AS rn
    FROM public.deposits
    WHERE did IS NOT NULL
  ) ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS deposits_did_key ON public.deposits (did);

-- The save reads child rows by job. job_files already has this; these did not.
CREATE INDEX IF NOT EXISTS expenses_job_id_idx ON public.expenses (job_id);
CREATE INDEX IF NOT EXISTS deposits_job_id_idx ON public.deposits (job_id);
