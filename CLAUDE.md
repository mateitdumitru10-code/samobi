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

### Numere

- Toate cantitățile și prețurile: `numeric(18,6)` în Postgres.
- În TypeScript se manipulează ca **string** sau prin `decimal.js`. **Niciodată `number`.**
- Rotunjirea la 3 zecimale se face o singură dată, la generarea XLSX-ului. Nicăieri altundeva.

### Coduri SAGA

- `cod_saga` este **text**, nu integer. Are zerouri semnificative în față (`00023684`).
- La scrierea în XLSX, coloana de cod primește format `@`. Fără asta, importul în SAGA eșuează.

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
- Nu implementa integrare API cu SAGA. Nu există.
- Nu adăuga funcționalități care nu sunt în `docs/SPEC.md`. Întreabă întâi.
