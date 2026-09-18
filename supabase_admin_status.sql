-- AquaCore MX - estados administrativos de pedidos
alter table public.orders
  add column if not exists admin_status text not null default 'active',
  add column if not exists canceled_at timestamptz,
  add column if not exists archived_at timestamptz;

create index if not exists orders_admin_status_idx
  on public.orders (admin_status);

grant select, insert, update, delete
  on table public.orders
  to service_role;
