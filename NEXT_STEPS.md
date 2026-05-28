# Supabase Connection Next Steps

Project URL:

```text
https://lqhdhflsgswctdwmojhd.supabase.co
```

## 1. Create The Backend

In Supabase:

1. Open `SQL Editor`.
2. Run `supabase/schema.sql`.
3. Run `supabase/seed.sql`.
4. Open `Authentication > Users`.
5. Create your first user.

## 2. Add Supabase To The Frontend

Copy the `supabase` folder into the same GitHub repository as `index.html`, then add these script tags before your main CRM script:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="./supabase/frontend-integration.js"></script>
```

## 3. Wire The App State

Your current CRM still saves to browser storage. Replace the browser-only load/save flow with:

```js
const remoteState = await crmLoadState();
TEAM = remoteState.TEAM;
USERS.length = 0;
remoteState.USERS.forEach(user => USERS.push(user));
pipelines = remoteState.pipelines;
currentPipelineId = remoteState.currentPipelineId;
jobs = remoteState.jobs;
syncActivePipeline();
renderBoard();
```

For writes:

- after creating or editing a job, call `await crmSaveJob(job)`
- after editing deposits or expenses, call `await crmSaveJobFinancials(job)`
- after changing team members, call `await crmSaveTeam(TEAM)`
- after changing pipelines or stages, call `await crmSavePipelines(pipelines)`
- for uploads, call `await crmUploadJobFile(jobId, category, file)`

## 4. Add Login

Use:

```js
await crmSignIn(email, password);
```

and:

```js
await crmSignOut();
```

The backend policies require users to be signed in before they can read or change CRM data.
