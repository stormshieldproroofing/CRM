-- Team sales totals per agent, so salesmen can see where they rank.
-- Salesmen can only read their own jobs (jobs_select policy); this returns
-- totals only — job count, signed-contract count and contract value per
-- agent — never names, addresses or any other job details.
create or replace function public.team_sales_by_agent(p_pipeline text default null)
returns table(agent_id text, signed_count integer, job_count integer, total_value numeric)
language sql
stable
security definer
set search_path = public
as $$
  with st as (
    select s.id, s.position,
      max(case when s.id = 'contract' or s.name ilike 'contract signed' then s.position end)
        over (partition by s.pipeline_id) as contract_pos,
      max(case when s.id = 'completed' or s.name ilike 'job completed' then s.position end)
        over (partition by s.pipeline_id) as completed_pos
    from stages s
  )
  select j.assigned_to,
         count(*) filter (
           where st.contract_pos is not null
             and st.position >= st.contract_pos
             and (st.completed_pos is null or st.position <= st.completed_pos)
         )::integer,
         count(*)::integer,
         coalesce(sum(j.pot_val), 0)
  from jobs j
  left join st on st.id = j.stage_id
  where j.assigned_to is not null
    and (p_pipeline is null or j.pipeline_id = p_pipeline)
    and public.my_member_id() is not null   -- signed-in team members only
  group by j.assigned_to;
$$;

revoke all on function public.team_sales_by_agent(text) from public, anon;
grant execute on function public.team_sales_by_agent(text) to authenticated;
