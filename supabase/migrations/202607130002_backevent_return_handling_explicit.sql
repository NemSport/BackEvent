do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'backevent_products'
      and column_name = 'return_handling'
  ) then
    alter table public.backevent_products
      alter column return_handling drop not null,
      alter column return_handling drop default;
  end if;
end $$;
