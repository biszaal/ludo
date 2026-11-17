-- Read-only, opted-in population only. These are not whole-player retention rates.
-- Run with an operator role; clients cannot read individual event history.
with first_seen as (
 select user_id, min(created_at)::date as cohort_day
 from public.product_events where event_name='session_started' group by user_id
), activity as (
 select distinct user_id, created_at::date as active_day from public.product_events
), cohorts as (
 select f.cohort_day, f.user_id,
 exists(select 1 from activity a where a.user_id=f.user_id and a.active_day=f.cohort_day+1) as d1,
 exists(select 1 from activity a where a.user_id=f.user_id and a.active_day=f.cohort_day+7) as d7
 from first_seen f
)
select cohort_day, count(*) as opted_in_players,
 case when cohort_day < current_date then round(avg(d1::int)*100,1) end as d1_percent,
 case when cohort_day < current_date-6 then round(avg(d7::int)*100,1) end as d7_percent
from cohorts group by cohort_day order by cohort_day;

select event_name, count(*) as events, count(distinct user_id) as players
from public.product_events where created_at >= now()-interval '7 days'
group by event_name order by event_name;
