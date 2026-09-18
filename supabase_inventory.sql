-- AquaCore MX - control de inventario
create table if not exists public.inventory (
  product_id integer primary key,
  stock numeric(14,3) not null default 0 check (stock >= 0),
  low_stock_threshold integer not null default 2 check (low_stock_threshold >= 0),
  managed boolean not null default false,
  source_code text,
  source_description text,
  source_file text,
  source_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.inventory
  alter column stock type numeric(14,3) using stock::numeric;

alter table public.inventory
  add column if not exists source_code text,
  add column if not exists source_description text,
  add column if not exists source_file text,
  add column if not exists source_updated_at timestamptz;

create index if not exists inventory_managed_idx
  on public.inventory (managed);

alter table public.inventory enable row level security;

grant select, insert, update, delete
  on table public.inventory
  to service_role;

alter table public.orders
  add column if not exists inventory_committed boolean not null default false;

create or replace function public.commit_order_inventory(p_folio text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders%rowtype;
  item jsonb;
  pid integer;
  q integer;
  inv public.inventory%rowtype;
begin
  select *
    into o
  from public.orders
  where folio = p_folio
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
  end if;

  if o.inventory_committed then
    return jsonb_build_object('ok', true, 'already_committed', true);
  end if;

  -- Primero valida todo el pedido para evitar descuentos parciales.
  for item in
    select value from jsonb_array_elements(coalesce(o.items, '[]'::jsonb))
  loop
    if item ? '_type' then
      continue;
    end if;

    pid := nullif(item->>'id','')::integer;
    q := greatest(1, coalesce(nullif(item->>'qty','')::integer, 1));

    if pid is null then
      continue;
    end if;

    select *
      into inv
    from public.inventory
    where product_id = pid
    for update;

    if found and inv.managed and inv.stock < q then
      return jsonb_build_object(
        'ok', false,
        'code', 'INSUFFICIENT_STOCK',
        'product_id', pid,
        'available', inv.stock,
        'requested', q
      );
    end if;
  end loop;

  -- Después descuenta únicamente los productos con stock administrado.
  for item in
    select value from jsonb_array_elements(coalesce(o.items, '[]'::jsonb))
  loop
    if item ? '_type' then
      continue;
    end if;

    pid := nullif(item->>'id','')::integer;
    q := greatest(1, coalesce(nullif(item->>'qty','')::integer, 1));

    if pid is null then
      continue;
    end if;

    update public.inventory
       set stock = stock - q,
           updated_at = now()
     where product_id = pid
       and managed = true;
  end loop;

  update public.orders
     set inventory_committed = true,
         updated_at = now()
   where folio = p_folio;

  return jsonb_build_object('ok', true, 'already_committed', false);
end;
$$;

revoke all on function public.commit_order_inventory(text) from public, anon, authenticated;
grant execute on function public.commit_order_inventory(text) to service_role;
