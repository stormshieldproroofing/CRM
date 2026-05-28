# StormShield CRM Supabase Backend

This folder gives your GitHub-hosted CRM a Supabase backend for login, database records, and private file storage.

## Files

- `schema.sql` creates the backend tables, security policies, and storage buckets.
- `seed.sql` adds your starter team and default Insurance pipeline.
- `frontend-integration.js` is a browser helper that converts between your current CRM objects and Supabase rows.
- `NEXT_STEPS.md` shows the exact order to connect the hosted frontend.

## Supabase Setup

1. Open your Supabase project.
2. Go to `SQL Editor`.
3. Paste and run `schema.sql`.
4. Paste and run `seed.sql`.
5. Go to `Authentication > Users`.
6. Create your first login user.

The starter security policy allows signed-in users to manage CRM data. That is the cleanest first version for a small team. Later, you can tighten access by `admin`, `manager`, and `salesman`.

## Backend Created

Database:

- `profiles`
- `team_members`
- `pipelines`
- `pipeline_stages`
- `jobs`
- `job_payments`
- `job_expenses`
- `job_files`
- `job_notes`

Private storage buckets:

- `crm-photos`
- `crm-contracts`
- `crm-checks`
- `crm-loss-statements`
- `crm-roof-measurements`
- `crm-other-files`

## Frontend Connection

Add this before the main CRM script in `index.html`:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="./supabase/frontend-integration.js"></script>
```

The helper is already configured with your Supabase URL and public anon key. Keep the service-role key out of frontend code.

## Important

This schema is designed to match your current frontend IDs like `insurance`, `lead`, and `mt`. If you already ran the older UUID-based draft schema in the same Supabase project, use a fresh Supabase project or delete the old draft tables before running this version.
