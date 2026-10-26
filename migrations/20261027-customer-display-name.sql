begin;
alter table vertex_debug.customer_accounts add column if not exists display_name text not null default '';
NOTIFY pgrst, 'reload schema';
commit;
