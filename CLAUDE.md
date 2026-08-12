# CLAUDE.md

Aplicație internă de gestiune a rețetelor de producție (mobilier tapițat) cu export
către programul de contabilitate SAGA.

## Stack

- **Monorepo**: pnpm workspaces — `apps/api`, `apps/web`, `packages/shared`
- **Bază de date**: Supabase (PostgreSQL 15+)
- **Autentificare**: Supabase Auth — invitații pe email, fără înregistrare publică
- **Fișiere**: Supabase Storage, bucket privat pentru exporturile XLSX
- **Backend**: Node ≥22 (local rulează 24), TypeScript strict, Fastify, Drizzle ORM
- **Frontend**: React 19, Vite, TanStack Query, TanStack Table, React Hook Form, Tailwind, shadcn/ui
- **Validare**: Zod, scheme definite în `packages/shared`, folosite de ambele capete
- **Excel**: ExcelJS
- **Formule**: `expr-eval` cu scope restricționat
- **Teste**: Vitest (unit), Playwright (e2e pe fluxurile critice)

## Comenzi

```bash
pnpm dev              # api pe :3000, web pe :5173
pnpm db:generate      # Drizzle generează SQL-ul migrării din schema TypeScript
pnpm db:push          # supabase db push — aplică migrările pe proiectul din cloud
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## Fără stack local

Nu există Docker pe această mașină, deci nu există `supabase start`. Baza de date este
**un singur proiect Supabase în cloud**, folosit și pentru dezvoltare, și pentru producție.
Consecințele, care schimbă modul de lucru:

- **Nu există `supabase db reset`.** O migrare greșită se repară printr-o migrare nouă,
  niciodată prin resetare. Scrie migrări care pot fi aplicate pe o bază cu date în ea.
- Migrările se generează cu `drizzle-kit generate` din `packages/shared/src/db/schema.ts`
  și se aplică cu `supabase db push`. Niciuna dintre cele două comenzi nu are nevoie de Docker.
- Testele care ating baza de date rulează pe proiectul real. Fiecare test își curăță
  singur datele și folosește prefixe distincte, ca să nu lovească date de producție.
- Logica de calcul (`packages/shared/src/calcul/`) se testează fără bază de date.
  Acolo stă acoperirea reală de teste.
- Emailurile de invitație pleacă real, prin SMTP-ul Supabase, limitat pe planul gratuit.

Când apar date reale în sistem, se creează un al doilea proiect Supabase pentru
dezvoltare. Până atunci, riscul e asumat.

## Reguli obligatorii

### Chei și acces

- **`SUPABASE_SERVICE_ROLE_KEY` trăiește exclusiv în `apps/api`.** Dacă apare oriunde
  în `apps/web`, în bundle sau într-o variabilă cu prefix `VITE_`, e o breșă de securitate.
  Cheia ocolește complet RLS.
- Frontend-ul folosește doar `SUPABASE_ANON_KEY`, și numai pentru autentificare.
- **Toate datele de business trec prin API-ul Fastify.** Frontend-ul nu interoghează
  niciodată tabelele direct prin clientul Supabase.

### Conexiuni

Supabase expune două moduri de conectare, iar confundarea lor e cea mai frecventă eroare:

- **Runtime API** → connection string prin pooler, în mod tranzacție
- **Migrări și `drizzle-kit`** → conexiune directă / mod sesiune

Migrările rulate prin pooler în mod tranzacție eșuează în moduri confuze. Ține două
variabile distincte: `DATABASE_URL` și `DIRECT_URL`.

Hostul „Direct connection" (`db.<ref>.supabase.co`) rezolvă **doar pe IPv6**. De pe o
rețea IPv4 dă `ENOTFOUND`. Ambele variabile folosesc deci hostul de pooler, diferite
doar prin port: `6543` pentru runtime, `5432` pentru migrări.

### Configurația Supabase

`supabase/config.toml` este sursa de adevăr pentru setările de autentificare, aplicate cu
`supabase config push`. Nu se modifică din interfața web — la următorul push se pierd.

Două capcane, ambele deja plătite o dată:

- `[auth.email] enable_signup = false` **oprește și autentificarea**, nu doar înregistrarea.
  Pentru a interzice conturile publice se folosește `[auth] enable_signup = false`.
- `config push` trimite tot fișierul, inclusiv valorile implicite de dezvoltare locală.
  Verifică diff-ul înainte: altfel coboară `otp_length`, `max_frequency` și
  `enable_confirmations` la valorile de test.

### Numere

- Toate cantitățile și prețurile: `numeric(18,6)` în Postgres.
- În TypeScript se manipulează ca **string** sau prin `decimal.js`. **Niciodată `number`.**
- Rotunjirea la 3 zecimale se face o singură dată, la generarea XLSX-ului. Nicăieri altundeva.

### Coduri SAGA

- `cod_saga` este **text**, nu integer. Are zerouri semnificative în față (`00023684`).
- La scrierea în XLSX, coloana de cod primește format `@`. Fără asta, importul în SAGA eșuează.

### API-ul SAGA

**SAGA WEB are API din iunie 2026.** Documentația: `https://web0.sagasoft.ro/sagac/DocumentatieAPI`.
Firma rulează SAGA WEB și SAGA C în paralel, conectate. Regula de dinainte — „nu există API" —
a fost adevărată când a fost scrisă și nu mai e.

Deocamdată **nu e integrat**: nu există niciun apel către SAGA în cod. Ce urmează sunt regulile
pentru momentul în care se scrie, nu descrierea a ceva existent.

- Bază: `https://web0.sagasoft.ro/sagac/api/v20260225`. Versiunea e o dată în cale, deci o
  schimbare de versiune e o schimbare de URL, nu o negociere de conținut. Hostul se ține într-o
  variabilă de mediu, nu în cod: `web0` e hostul pe care s-a găsit documentația, iar dacă SAGA mută
  clienții pe alt nod, nu vrem o recompilare.
- Autentificare: `Authorization: Bearer <token>` **plus** `X-Saga-Cod-Fiscal: <CUI>`. Token-ul se
  generează din SAGA WEB, Administrare → Utilizatori, doar de pe un cont de administrator.
- `SAGA_API_TOKEN` și `SAGA_COD_FISCAL` trăiesc exclusiv în `apps/api`, ca
  `SUPABASE_SERVICE_ROLE_KEY`. În `apps/web` sau sub prefix `VITE_` e breșă de securitate.
- **O rotire ratată blochează cheia.** Documentația: „În anumite situații, răspunsul va conține
  [...] o nouă cheie de acces în header-ul `X-Saga-Refresh-Token`. Aceasta trebuie salvată pentru a
  putea fi folosită la următorul apel. În caz contrar, cheia de acces va fi blocată și va trebui să
  generați una nouă." Rotirea nu vine la fiecare apel, deci codul care o ignoră merge — până nu mai
  merge deloc. Verificat pe viu: un răspuns **400** a purtat antetul de rotire, iar cheia
  nesalvată a fost blocată. O cerere eșuată rotește la fel ca una reușită. Consecințele nu sunt
  negociabile:
  - Noul token se persistă **înainte** de a citi corpul răspunsului, pe orice cale de ieșire,
    inclusiv la eroare. Un `throw` înaintea salvării blochează integrarea până la regenerare
    manuală din SAGA WEB.
  - Apelurile către SAGA se **serializează**. Două cereri simultane cu același token înseamnă că
    una primește 401 și, mai rău, se poate salva token-ul perdantului. Blocare consultativă în
    Postgres în jurul fiecărui apel, nu doar în jurul scrierii.
  - **Cu cât mai puține apeluri, cu atât mai bine.** Fiecare apel e o ocazie de a pierde cheia.
    Un snapshot bulk, rar, e mai sigur decât zeci de citiri punctuale.
  - Un răspuns pierdut pe drum (timeout) e ambiguu: serverul poate să fi rotit cheia fără ca noi
    să aflăm noua valoare. Nu există recuperare automată — trebuie un drum manual de reintroducere
    a cheii, altfel un timeout oprește funcția până când cineva intră în SAGA.
  - Variabila de mediu e doar sămânța de pornire. Mașina Fly are `auto_stop_machines = "suspend"`,
    deci memoria procesului nu supraviețuiește; valoarea curentă stă în bază.
- Datele se trimit strict `dd.MM.yyyy`. Orice alt format întoarce eroare.
- Cantitățile vin ca **string**. Rămân string — regula de la „Numere" nu are excepție aici.
- Scrierea există, dar nu pentru noi. `POST /Import` primește XML pentru șapte tipuri de document,
  după prefixul fișierului: `F_` facturi, `C_` comenzi, `I_` încasări, `P_` plăți, `FUR_` furnizori,
  `CLI_` clienți, `ART_` articole. **Bonul de consum nu e printre ele**, iar exportul nostru intră
  în ecranul `Producție` al SAGA. Deci exportul de consumuri rămâne fișierul XLSX, nu din
  preferință, ci fiindcă nu există endpoint care să-l primească.
- Stocul citit prin API **nu știe de bonurile emise și neexportate încă** — descărcarea se
  întâmplă abia la importul fișierului în SAGA. Orice comparație cu necesarul scade întâi consumul
  bonurilor cu status `calculat`.
- SAGA indisponibilă nu blochează emiterea unui bon. Consumul fizic s-a întâmplat deja în atelier;
  documentul iese, iar faptul că stocul era necunoscut rămâne în audit.

### Formule

- Se evaluează **exclusiv** prin `expr-eval` cu scope explicit. `eval()` și
  `new Function()` sunt interzise.
- Variabile permise: `L`, `l`, `H`. Nimic altceva.
- Orice formulă se validează la salvare, nu la execuție.

### Bază de date

- Invarianții de business se exprimă ca **constrângeri în DB**, nu doar în cod.
- **RLS activat pe fiecare tabel din `public`**, cu politică implicită deny-all.
  API-ul folosește service role și ocolește RLS, dar RLS rămâne plasa de siguranță
  pentru cazul în care ceva ajunge expus din greșeală.
- Tabelele proprii se creează în schema `public`. **Schema `auth` aparține Supabase —
  nu se modifică niciodată.**
- Rețetele active sunt imutabile. Orice modificare creează o versiune nouă.
- Fără `DELETE` pe rețete, bonuri sau utilizatori — doar dezactivare logică.

### Migrări

- Orice schimbare de schemă e o migrare versionată în `supabase/migrations/`.
- Nu se modifică schema din interfața web Supabase. Ce nu e într-o migrare nu există.

## Stil de cod

- TypeScript strict, fără `any`.
- Logica de calcul: funcții pure în `packages/shared/src/calcul/`, izolate de I/O.
- Erorile de business sunt clase tipizate, nu string-uri aruncate.
- Mesajele către utilizator în **română**. Cod, comentarii și variabile în **engleză**,
  cu excepția termenilor de domeniu (`reteta`, `gestiune`, `bon`).

## Ce să NU faci

- Nu scrie de la zero autentificare, hashing de parole sau resetare de parolă.
  Supabase Auth le rezolvă pe toate.
- Nu expune tabelele direct către frontend prin PostgREST.
- Nu introduce alt ORM, alt framework de UI sau altă librărie de state management.
- Nu genera fișiere XLSX cu formule — exportul e date brute.
- Nu încerca să trimiți consumurile prin API-ul SAGA. Nu există tip de document pentru ele.
  Citirea stocurilor e permisă, după regulile de la „API-ul SAGA".
- Nu adăuga funcționalități care nu sunt în `docs/SPEC.md`. Întreabă întâi.
