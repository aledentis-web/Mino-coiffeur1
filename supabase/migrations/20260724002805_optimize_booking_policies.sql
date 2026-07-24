create index if not exists appointments_business_resource_idx
  on public.appointments (business_id, resource_id);

create index if not exists appointments_business_customer_idx
  on public.appointments (business_id, customer_id, starts_at desc);

create index if not exists appointments_business_service_idx
  on public.appointments (business_id, service_id);

create index if not exists appointments_created_by_idx
  on public.appointments (created_by)
  where created_by is not null;

create index if not exists customer_service_profiles_business_service_idx
  on public.customer_service_profiles (business_id, service_id);

drop index if exists public.appointments_customer_id_idx;
drop index if exists public.appointments_service_id_idx;
drop index if exists public.customer_service_profiles_customer_id_idx;
drop index if exists public.customer_service_profiles_service_id_idx;

drop policy if exists resources_write_members on public.resources;
drop policy if exists resources_insert_members on public.resources;
drop policy if exists resources_update_members on public.resources;
drop policy if exists resources_delete_members on public.resources;

create policy resources_insert_members
on public.resources for insert to authenticated
with check (private.has_business_access(business_id));

create policy resources_update_members
on public.resources for update to authenticated
using (private.has_business_access(business_id))
with check (private.has_business_access(business_id));

create policy resources_delete_members
on public.resources for delete to authenticated
using (private.has_business_access(business_id));

drop policy if exists services_write_members on public.services;
drop policy if exists services_insert_members on public.services;
drop policy if exists services_update_members on public.services;
drop policy if exists services_delete_members on public.services;

create policy services_insert_members
on public.services for insert to authenticated
with check (private.has_business_access(business_id));

create policy services_update_members
on public.services for update to authenticated
using (private.has_business_access(business_id))
with check (private.has_business_access(business_id));

create policy services_delete_members
on public.services for delete to authenticated
using (private.has_business_access(business_id));

drop policy if exists customers_write_members on public.customers;
drop policy if exists customers_insert_members on public.customers;
drop policy if exists customers_update_members on public.customers;
drop policy if exists customers_delete_members on public.customers;

create policy customers_insert_members
on public.customers for insert to authenticated
with check (private.has_business_access(business_id));

create policy customers_update_members
on public.customers for update to authenticated
using (private.has_business_access(business_id))
with check (private.has_business_access(business_id));

create policy customers_delete_members
on public.customers for delete to authenticated
using (private.has_business_access(business_id));

drop policy if exists customer_service_profiles_write_members
  on public.customer_service_profiles;
drop policy if exists customer_service_profiles_insert_members
  on public.customer_service_profiles;
drop policy if exists customer_service_profiles_update_members
  on public.customer_service_profiles;
drop policy if exists customer_service_profiles_delete_members
  on public.customer_service_profiles;

create policy customer_service_profiles_insert_members
on public.customer_service_profiles for insert to authenticated
with check (private.has_business_access(business_id));

create policy customer_service_profiles_update_members
on public.customer_service_profiles for update to authenticated
using (private.has_business_access(business_id))
with check (private.has_business_access(business_id));

create policy customer_service_profiles_delete_members
on public.customer_service_profiles for delete to authenticated
using (private.has_business_access(business_id));

drop policy if exists appointments_write_members on public.appointments;
drop policy if exists appointments_insert_members on public.appointments;
drop policy if exists appointments_update_members on public.appointments;
drop policy if exists appointments_delete_members on public.appointments;

create policy appointments_insert_members
on public.appointments for insert to authenticated
with check (private.has_business_access(business_id));

create policy appointments_update_members
on public.appointments for update to authenticated
using (private.has_business_access(business_id))
with check (private.has_business_access(business_id));

create policy appointments_delete_members
on public.appointments for delete to authenticated
using (private.has_business_access(business_id));
