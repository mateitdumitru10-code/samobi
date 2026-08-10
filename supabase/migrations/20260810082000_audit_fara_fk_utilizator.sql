-- audit_log.user_id nu mai este cheie straina catre profile.
--
-- Un jurnal de audit trebuie sa supravietuiasca entitatii pe care o descrie.
-- Cu FK, primul rand de audit facea contul imposibil de sters: DELETE pe
-- profile esua, iar auth.admin.deleteUser raporta succes fara sa stearga nimic.
-- Efectul practic era ca un cont care s-a autentificat macar o data devenea
-- permanent, indiferent de ce cerea legea sau administratorul.
--
-- Pastram uuid-ul ca valoare. Cine a facut actiunea ramane consemnat chiar daca
-- profilul dispare -- exact ce se asteapta de la un audit.

alter table public.audit_log
  drop constraint if exists audit_log_user_id_profile_id_fk;

comment on column public.audit_log.user_id is
  'Autorul actiunii. Fara FK: auditul supravietuieste stergerii profilului.';
