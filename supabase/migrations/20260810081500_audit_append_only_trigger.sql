-- REVOKE nu este suficient.
--
-- Migrarea precedenta a revocat UPDATE si DELETE de la public, anon,
-- authenticated si service_role. Dar privilegiile nu se aplica proprietarului
-- tabelei, iar API-ul se conecteaza prin DATABASE_URL ca rolul `postgres`, care
-- este exact proprietarul. Cu alte cuvinte, calea reala a aplicatiei ocolea
-- complet protectia.
--
-- Un trigger care ridica exceptie opreste orice rol, proprietar inclus.

create or replace function public.audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log este append-only: % nu este permis', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

comment on function public.audit_log_append_only() is
  'Refuza UPDATE, DELETE si TRUNCATE pe audit_log, indiferent de rolul conectat.';

drop trigger if exists audit_log_fara_update on public.audit_log;
drop trigger if exists audit_log_fara_delete on public.audit_log;
drop trigger if exists audit_log_fara_truncate on public.audit_log;

create trigger audit_log_fara_update
  before update on public.audit_log
  for each row execute function public.audit_log_append_only();

create trigger audit_log_fara_delete
  before delete on public.audit_log
  for each row execute function public.audit_log_append_only();

create trigger audit_log_fara_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_append_only();
