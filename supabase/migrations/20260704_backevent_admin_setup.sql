drop policy if exists "backevent admin insert products" on public.backevent_products;
create policy "backevent admin insert products"
  on public.backevent_products for insert to authenticated
  with check (public.backevent_is_admin());

drop policy if exists "backevent admin update products" on public.backevent_products;
create policy "backevent admin update products"
  on public.backevent_products for update to authenticated
  using (public.backevent_is_admin())
  with check (public.backevent_is_admin());

drop policy if exists "backevent admin insert locations" on public.backevent_locations;
create policy "backevent admin insert locations"
  on public.backevent_locations for insert to authenticated
  with check (public.backevent_is_admin());

drop policy if exists "backevent admin update locations" on public.backevent_locations;
create policy "backevent admin update locations"
  on public.backevent_locations for update to authenticated
  using (public.backevent_is_admin())
  with check (public.backevent_is_admin());

-- TODO before market: if real reset/delete functions are needed, implement them
-- as admin-only RPCs with explicit audit rows. Update 6 keeps reset as guarded UI only.
