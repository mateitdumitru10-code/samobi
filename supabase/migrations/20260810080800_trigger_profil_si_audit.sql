-- Ce nu poate exprima drizzle-kit: trigger pe auth.users, privilegii, politici RLS.
--
-- Nota despre RLS: fiecare tabel din public are RLS activat de migrarea
-- precedenta si NICIO politica permisiva. In Postgres asta inseamna deny-all
-- pentru anon si authenticated. API-ul Fastify foloseste service role si
-- ocoleste RLS deliberat; RLS ramane plasa de siguranta pentru cazul in care un
-- tabel ajunge expus din greseala prin PostREST.

-- ---------------------------------------------------------------------------
-- profile: se creeaza automat la inregistrarea in Supabase Auth
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nume text;
  v_rol text;
  v_creat_de uuid;
begin
  v_nume := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'nume', '')), '');
  if v_nume is null then
    v_nume := split_part(coalesce(new.email, 'utilizator'), '@', 1);
  end if;

  -- Rolul vine din metadata de la invitatie. Orice altceva devine 'operator':
  -- un rol necunoscut nu trebuie sa blocheze crearea contului, dar nici sa
  -- acorde drepturi din greseala. Cel mai mic privilegiu castiga.
  v_rol := coalesce(new.raw_user_meta_data ->> 'rol', 'operator');
  if v_rol not in ('admin', 'tehnolog', 'operator', 'contabil') then
    v_rol := 'operator';
  end if;

  begin
    v_creat_de := nullif(new.raw_user_meta_data ->> 'creat_de', '')::uuid;
  exception when invalid_text_representation then
    v_creat_de := null;
  end;

  insert into public.profile (id, nume, rol, creat_de)
  values (new.id, v_nume, v_rol, v_creat_de)
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creeaza randul din public.profile la inregistrarea unui utilizator in Supabase Auth.';

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- audit_log: append-only, impus in baza de date
-- ---------------------------------------------------------------------------

-- Fara asta, un bug in API poate rescrie istoricul. Revocarea loveste si service
-- role: RLS se poate ocoli, privilegiile de tabel nu.
revoke update, delete, truncate on public.audit_log from public;
revoke update, delete, truncate on public.audit_log from anon, authenticated, service_role;

drop policy if exists audit_log_doar_insert on public.audit_log;

create policy audit_log_doar_insert
  on public.audit_log
  for insert
  to authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- model.modificat_la
-- ---------------------------------------------------------------------------

create or replace function public.atinge_modificat_la()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.modificat_la := now();
  return new;
end;
$$;

drop trigger if exists model_modificat_la on public.model;

create trigger model_modificat_la
  before update on public.model
  for each row execute function public.atinge_modificat_la();
