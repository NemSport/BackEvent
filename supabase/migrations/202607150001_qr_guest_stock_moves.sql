alter table public.backevent_stock_movement_batches
  add column if not exists performed_by_user_id uuid null references auth.users(id) on delete set null,
  add column if not exists performed_by_name text null,
  add column if not exists performed_by_type text null;

alter table public.backevent_stock_movements
  add column if not exists performed_by_user_id uuid null references auth.users(id) on delete set null,
  add column if not exists performed_by_name text null,
  add column if not exists performed_by_type text null;

update public.backevent_stock_movement_batches
set performed_by_name = created_by_name
where performed_by_name is null and created_by_name is not null;

update public.backevent_stock_movements
set performed_by_name = created_by_name
where performed_by_name is null and created_by_name is not null;

alter table public.backevent_stock_movement_batches
  drop constraint if exists backevent_stock_movement_batches_performed_by_type_check;
alter table public.backevent_stock_movement_batches
  add constraint backevent_stock_movement_batches_performed_by_type_check
  check (performed_by_type is null or performed_by_type in ('user', 'guest'));

create table if not exists public.backevent_qr_guest_rate_limits (
  fingerprint text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint backevent_qr_guest_rate_limits_fingerprint_check
    check (fingerprint ~ '^[0-9a-f]{64}$'),
  constraint backevent_qr_guest_rate_limits_request_count_check
    check (request_count >= 0)
);

alter table public.backevent_qr_guest_rate_limits enable row level security;
revoke all on table public.backevent_qr_guest_rate_limits from public, anon, authenticated;

create or replace function public.backevent_allow_qr_guest_move(p_fingerprint text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_started_at timestamptz;
  v_request_count integer;
begin
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Ugyldig rate-limit fingerprint';
  end if;

  v_window_started_at := to_timestamp(floor(extract(epoch from clock_timestamp()) / 600) * 600);

  insert into public.backevent_qr_guest_rate_limits (
    fingerprint, window_started_at, request_count, updated_at
  ) values (
    p_fingerprint, v_window_started_at, 1, now()
  )
  on conflict (fingerprint) do update
  set window_started_at = case
        when backevent_qr_guest_rate_limits.window_started_at < excluded.window_started_at
          then excluded.window_started_at
        else backevent_qr_guest_rate_limits.window_started_at
      end,
      request_count = case
        when backevent_qr_guest_rate_limits.window_started_at < excluded.window_started_at then 1
        else backevent_qr_guest_rate_limits.request_count + 1
      end,
      updated_at = now()
  returning request_count into v_request_count;

  return v_request_count <= 10;
end;
$$;

revoke all on function public.backevent_allow_qr_guest_move(text) from public, anon, authenticated;
grant execute on function public.backevent_allow_qr_guest_move(text) to service_role;

alter table public.backevent_stock_movements
  drop constraint if exists backevent_stock_movements_performed_by_type_check;
alter table public.backevent_stock_movements
  add constraint backevent_stock_movements_performed_by_type_check
  check (performed_by_type is null or performed_by_type in ('user', 'guest'));

create or replace function public.backevent_create_qr_stock_movement_batch(
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_lines jsonb,
  p_performed_by_name text,
  p_performed_by_type text,
  p_performed_by_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_line jsonb;
  v_product_id uuid;
  v_quantity numeric;
  v_unit text;
  v_available numeric;
  v_active_location_count integer;
  v_seen_product_ids uuid[] := array[]::uuid[];
begin
  if p_from_location_id is null or p_to_location_id is null then
    raise exception 'Fra og til mangler';
  end if;

  if p_from_location_id = p_to_location_id then
    raise exception 'Fra og til skal være forskellige steder';
  end if;

  select count(*) into v_active_location_count
  from public.backevent_locations
  where id in (p_from_location_id, p_to_location_id) and active = true;

  if v_active_location_count <> 2 then
    raise exception 'Lokationen findes ikke eller er deaktiveret';
  end if;

  if p_performed_by_name is null or length(trim(p_performed_by_name)) < 2 then
    raise exception 'Navn mangler';
  end if;

  if length(trim(p_performed_by_name)) > 320 then
    raise exception 'Navnet er for langt';
  end if;

  if p_performed_by_type = 'guest' and p_performed_by_name ~ '[<>&[:cntrl:]]' then
    raise exception 'Navnet indeholder ugyldige tegn';
  end if;

  if p_performed_by_type not in ('user', 'guest') then
    raise exception 'Ugyldig registreringstype';
  end if;

  if p_performed_by_type = 'guest' and p_performed_by_user_id is not null then
    raise exception 'Gæst må ikke have bruger-id';
  end if;

  if p_performed_by_type = 'user' and p_performed_by_user_id is null then
    raise exception 'Bruger-id mangler';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 100 then
    raise exception 'Vælg mindst én vare';
  end if;

  -- Sorteringen giver en stabil låserækkefølge ved samtidige batchflyt.
  for v_line in
    select value from jsonb_array_elements(p_lines) as lines(value)
    order by value->>'productId'
  loop
    begin
      v_product_id := nullif(v_line->>'productId', '')::uuid;
      v_quantity := nullif(v_line->>'quantity', '')::numeric;
    exception when others then
      raise exception 'Ugyldig varelinje';
    end;

    if v_product_id is null or v_quantity is null or v_quantity <= 0 or v_quantity > 1000000 then
      raise exception 'Ugyldig varelinje';
    end if;

    if v_product_id = any(v_seen_product_ids) then
      raise exception 'Den samme vare må kun vælges én gang';
    end if;
    v_seen_product_ids := array_append(v_seen_product_ids, v_product_id);

    select unit into v_unit
    from public.backevent_products
    where id = v_product_id and active = true and tracking_mode = 'inventory';

    if not found then
      raise exception 'Varen findes ikke eller er deaktiveret';
    end if;

    insert into public.backevent_stock_balances (product_id, location_id, quantity)
    values (v_product_id, p_from_location_id, 0), (v_product_id, p_to_location_id, 0)
    on conflict (product_id, location_id) do nothing;

    select quantity into v_available
    from public.backevent_stock_balances
    where product_id = v_product_id and location_id = p_from_location_id
    for update;

    if v_available is null or v_quantity > v_available then
      raise exception 'Der er ikke nok på lager';
    end if;
  end loop;

  insert into public.backevent_stock_movement_batches (
    from_location_id, to_location_id, source, created_by_name,
    performed_by_user_id, performed_by_name, performed_by_type
  ) values (
    p_from_location_id, p_to_location_id, 'qr_' || p_performed_by_type, trim(p_performed_by_name),
    p_performed_by_user_id, trim(p_performed_by_name), p_performed_by_type
  ) returning id into v_batch_id;

  for v_line in select value from jsonb_array_elements(p_lines) as lines(value)
  loop
    v_product_id := (v_line->>'productId')::uuid;
    v_quantity := (v_line->>'quantity')::numeric;
    select coalesce(nullif(unit, ''), 'kasser') into v_unit
    from public.backevent_products where id = v_product_id;

    update public.backevent_stock_balances
    set quantity = quantity - v_quantity, updated_at = now()
    where product_id = v_product_id and location_id = p_from_location_id;

    update public.backevent_stock_balances
    set quantity = quantity + v_quantity, updated_at = now()
    where product_id = v_product_id and location_id = p_to_location_id;

    insert into public.backevent_stock_movements (
      batch_id, product_id, from_location_id, to_location_id, quantity, unit, note,
      created_by_name, source, performed_by_user_id, performed_by_name, performed_by_type
    ) values (
      v_batch_id, v_product_id, p_from_location_id, p_to_location_id, v_quantity, v_unit,
      'QR samlet flytning', trim(p_performed_by_name), 'qr_' || p_performed_by_type,
      p_performed_by_user_id, trim(p_performed_by_name), p_performed_by_type
    );
  end loop;

  return v_batch_id;
end;
$$;

revoke all on function public.backevent_create_qr_stock_movement_batch(uuid, uuid, jsonb, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.backevent_create_qr_stock_movement_batch(uuid, uuid, jsonb, text, text, uuid)
  to service_role;
