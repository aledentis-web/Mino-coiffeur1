with names as (
  select
    row_number() over () as position,
    first_name,
    last_name
  from unnest(
    array[
      'Alessandro', 'Luca', 'Matteo', 'Andrea', 'Marco',
      'Davide', 'Federico', 'Simone', 'Riccardo', 'Francesco',
      'Gabriele', 'Stefano', 'Michele', 'Tommaso', 'Pietro',
      'Filippo', 'Edoardo', 'Giovanni', 'Niccolò', 'Samuele'
    ]
  ) with ordinality as first_names(first_name, first_position)
  cross join unnest(
    array['Rossi', 'Bianchi', 'Ferrari', 'Esposito', 'Romano']
  ) with ordinality as last_names(last_name, last_position)
  order by last_position, first_position
),
customers_to_insert as (
  select
    '00000000-0000-4000-8000-000000000008'::uuid as business_id,
    first_name || ' ' || last_name as name,
    '+39000000' || lpad(position::text, 4, '0') as phone_e164,
    case
      when (position - 1) % 3 = 0
        then 'Durata abituale personalizzata.'
      else 'Cliente sintetico per il business test.'
    end as notes
  from names
)
insert into public.customers (business_id, name, phone_e164, notes)
select business_id, name, phone_e164, notes
from customers_to_insert
on conflict (business_id, phone_e164) do update
set name = excluded.name,
    notes = excluded.notes;

with ranked_customers as (
  select
    id,
    business_id,
    row_number() over (order by phone_e164) as position
  from public.customers
  where business_id = '00000000-0000-4000-8000-000000000008'
    and phone_e164 like '+39000000%'
),
ranked_services as (
  select
    id,
    business_id,
    row_number() over (order by sort_order) as position
  from public.services
  where business_id = '00000000-0000-4000-8000-000000000008'
)
insert into public.customer_service_profiles (
  business_id,
  customer_id,
  service_id,
  duration_override_minutes,
  notes
)
select
  customer.business_id,
  customer.id,
  service.id,
  greatest(
    15,
    case service.position
      when 1 then 30
      when 2 then 20
      when 3 then 45
      else 15
    end + case when customer.position % 2 = 1 then 10 else -5 end
  ),
  'Durata personale usata dal test dei 100 clienti.'
from ranked_customers as customer
join ranked_services as service
  on service.business_id = customer.business_id
 and service.position = ((customer.position - 1) % 4) + 1
where (customer.position - 1) % 3 = 0
on conflict (business_id, customer_id, service_id) do update
set duration_override_minutes = excluded.duration_override_minutes,
    notes = excluded.notes;
