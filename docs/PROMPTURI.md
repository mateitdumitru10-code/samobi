# Prompturi pentru Claude Code

Rulează-le **în ordine**, câte unul pe sesiune. După fiecare, verifică rezultatul și fă
commit înainte de următorul. Nu le concatena — un prompt lung produce un schelet
superficial pentru tot, în loc de un modul care chiar funcționează.

Înainte de a începe, tu (nu Claude Code) trebuie să faci trei lucruri manual:

1. Creează un proiect pe supabase.com, regiune Frankfurt
2. Instalează Supabase CLI (Docker nu e necesar — nu se folosește stack local)
3. Pune `CLAUDE.md` în rădăcina repo-ului și `docs/SPEC.md` lângă el

Restul poate face Claude Code.

---

## 0. Pornire

```
Citește CLAUDE.md și docs/SPEC.md în întregime înainte să scrii cod.

Inițializează monorepo-ul: pnpm workspaces cu apps/api, apps/web, packages/shared.
TypeScript strict, ESLint, Prettier, Vitest.

Configurează Supabase pentru dezvoltare locală: supabase init, apoi verifică faptul
că supabase start pornește stack-ul complet în Docker.

Setează cele două variabile de conexiune separat, conform CLAUDE.md:
DATABASE_URL pentru runtime (pooler, mod tranzacție) și DIRECT_URL pentru migrări
(conexiune directă). Documentează în .env.example care e care și de ce.

Nu implementa încă nicio funcționalitate de business. Vreau scheletul care compilează,
cu supabase start, pnpm dev, pnpm typecheck și pnpm test funcționale.

La final, listează ce ai creat și ce decizii ai luat care nu erau în spec.
```

## 1. Schema și RLS

```
Implementează schema completă din secțiunea 3 din docs/SPEC.md, ca migrare Supabase
în supabase/migrations/. Definește tipurile Drizzle corespunzătoare în
packages/shared/src/db/schema.ts.

Verific explicit:
- toate cantitățile și prețurile: numeric(18,6)
- cod_saga: text, nu integer
- indexul parțial unic one_active_recipe_per_model
- profile cu FK către auth.users, plus trigger-ul care creează rândul la înregistrare
- audit_log append-only: REVOKE UPDATE, DELETE + politici RLS doar pentru INSERT
- RLS activat pe FIECARE tabel din public, cu politică implicită deny-all

Adaugă un seed cu datele de exemplu din spec: modelele PAT-DAVID și COLTAR-ECO-II,
materialele TOSCANA 247/257 și CHERESTEA TIVITA FAG/PIN.

Scrie teste care verifică faptul că constrângerile chiar resping datele invalide:
două rețete active pe același model, UPDATE pe audit_log, cantitate cu prea multe
zecimale.
```

## 2. Autentificare și conturi

```
Implementează modulul de autentificare pe Supabase Auth, conform secțiunilor 3 și 4
din SPEC.md.

NU scrie hashing de parole, gestiune de sesiuni sau resetare de parolă. Supabase Auth
le rezolvă. Ce implementezi tu:

- fluxul de invitație: admin completează email/nume/rol, API-ul apelează
  auth.admin.inviteUserByEmail cu rolul în metadata
- middleware Fastify care validează JWT-ul și citește rolul din tabela profile
  (nu din token — un token poate fi vechi)
- verificare explicită de rol pe fiecare rută
- dezactivare cont: activ=false ȘI ban prin auth.admin.updateUserById, altfel
  sesiunile emise rămân valide
- audit pentru: login, login eșuat, creare cont, schimbare rol, dezactivare

Frontend: login, activare invitație, ecran de administrare conturi.
Frontend-ul primește doar SUPABASE_ANON_KEY. Dacă service role key ajunge în
apps/web sau într-o variabilă VITE_, e o breșă — verifică asta înainte de a termina.

Testează cu Vitest că un operator primește 403 pe rutele de tehnolog.
```

## 3. Motorul de calcul

```
Implementează calculeazaConsumuri din secțiunea 5 din SPEC.md, în
packages/shared/src/calcul/. Funcție pură, fără acces la bază de date.

decimal.js pentru toată aritmetica. Formulele prin expr-eval cu scope explicit
{L, l, H} — eval() și new Function() sunt interzise.

Respectă ordinea de prioritate: override manual bate formula, întotdeauna.
mod_calcul='tabel' fără valoare pe dimensiunea cerută → eroare tipizată, nu zero.

Scrie testele întâi. Acoperă minim:
- toate cele trei moduri de calcul
- override care suprascrie o formulă
- procent de pierderi
- agregarea a două linii cu același cod_saga
- formulă invalidă, variabilă necunoscută, împărțire la zero
- rotunjire: un caz unde aritmetica în float ar da rezultat greșit

Acesta e modulul cel mai important din aplicație. Nu trece mai departe până nu
trec toate testele.
```

## 4. Nomenclator

```
Implementează secțiunea 7 din SPEC.md.

- import XLSX cu articolele exportate din SAGA, upsert după cod_saga
- raport după import: articole noi, modificate, dispărute
- coada de materiale nemapate, cu sugestii pe similaritate de denumire
- listă cu căutare și filtrare pe categorie și tip

La citirea XLSX-ului, cod_saga se tratează ca text. Dacă Excel îl livrează ca număr,
reconstituie zerourile prin padding la 8 caractere.
```

## 5. Modele, dimensiuni, rețetar

```
Implementează modulele 5 și 6 din secțiunea 8 din SPEC.md.

Interfața de editare a rețetelor e partea grea:
- grid editabil cu TanStack Table, navigare cu tastatura ca în Excel
- coloana MOD_CALCUL schimbă ce câmpuri sunt active pe rând
- validarea formulei în timp real, cu previzualizarea rezultatului pe o dimensiune aleasă
- override-urile marcate vizibil, cu autor și motiv
- optimistic locking prin lock_version: la conflict, 409 cu mesaj clar

Încă fără workflow de aprobare — rețetele rămân editabile deocamdată.
```

## 6. Bonuri și export

```
Implementează modulul 7 din secțiunea 8 din SPEC.md.

Flux: alegi model → dimensiune → cantitate → materiale pentru liniile variabile
→ previzualizezi consumurile → salvezi bonul.

Export: selectezi bonurile în status 'calculat', generezi XLSX cu coloanele
Cod, Denumire, UM, Cantitate din secțiunea 6.

CRITIC: coloana Cod se scrie cu numFmt '@' în ExcelJS. Fără asta zerourile din față
se pierd și importul în SAGA eșuează. Scrie un test care citește fișierul generat
înapoi și verifică valoarea exactă '00023684'.

Fișierul se salvează într-un bucket PRIVAT din Supabase Storage. Descărcarea prin
URL semnat cu expirare scurtă, generat de API după verificarea rolului. Bucketul
nu este public.

După export: bonurile primesc status 'exportat' și export_id, se salvează hash-ul.
Un bon deja exportat nu se reexportă fără confirmare explicită.
```

## 7. Versionare și aprobare

```
Implementează modulul 8 din secțiunea 8 din SPEC.md.

- workflow draft → in_aprobare → activa → arhivata
- rețetele active devin imutabile; modificarea creează versiune nouă
- doar admin aprobă, și nu își poate aproba propria rețetă
- ecran de comparare între două versiuni

Verifică faptul că bonurile vechi continuă să referențieze versiunea cu care au fost
calculate și se recalculează identic.
```

---

## Cum să lucrezi cu Claude Code

- **Cere planul înainte de cod** pe modulele mari: „arată-mi cum ai de gând să
  structurezi asta, înainte să scrii" — corectezi direcția când e ieftin.
- **Fără stack local.** Baza e proiectul din cloud, deci nu există `supabase db reset`.
  Orice migrare greșită se repară printr-o migrare nouă. Verifică `supabase db push`
  înainte de a-l rula.
- **Un commit per modul**, cu teste care trec.
- **Când greșește, arată-i rezultatul**, nu descrierea: mesajul de eroare, ieșirea
  testului, screenshot-ul.
- **Actualizează SPEC.md** când vă răzgândiți. Un spec desincronizat e mai rău decât niciunul.

## Verificare de securitate, înainte de primul deploy

Rulează asta ca prompt separat, după modulul 2 și din nou înainte de lansare:

```
Verifică următoarele și raportează fiecare cu dovada concretă din cod:

1. SUPABASE_SERVICE_ROLE_KEY apare undeva în apps/web sau într-o variabilă VITE_?
2. Fiecare tabel din public are RLS activat?
3. Există vreo rută în API fără verificare de rol, în afară de health check?
4. Bucketul de exporturi este privat?
5. Rolul se citește din tabela profile, nu din JWT fără verificare?

Pentru fiecare punct, arată-mi fișierul și linia. Nu răspunde „da" fără dovadă.
```
