# Specificație funcțională

## 1. Contextul

Firma produce mobilier tapițat: paturi, canapele, colțare, saltele. Contabilitatea se ține
în SAGA. În ecranul `Producție` din SAGA se întocmesc bonuri de predare: în tabelul superior
produsul finit, în tabelul inferior materiile prime consumate.

Introducerea manuală a consumurilor este lentă și predispusă la erori. Aplicația ține
rețetele produselor, calculează consumurile în funcție de dimensiuni și generează fișierul
XLSX care se importă în ecranul `Producție` din SAGA Web.

**Integrarea cu SAGA se face exclusiv prin fișiere.** Nu există API. Nu se scrie în baza de
date SAGA sub nicio formă. Importul XLSX a fost testat și funcționează.

## 2. Conceptele de domeniu

Ierarhia, de la abstract la concret:

```
MODEL           PAT DAVID
                └── rețeta parametrică: liniile de material, cu formule în L, l, H

DIMENSIUNE      2000 × 1600 × 350
                └── valori concrete pentru parametrii modelului

VARIANTĂ        PAT DAVID 2000/1600, tapițerie Toscana 247
                └── model + dimensiune + alegeri de material

ARTICOL SAGA    00022107 "PAT DAVID SOMIERA 2000/1600"
                └── codul din nomenclatorul SAGA, unde se predă produsul
```

Rețeta se definește **o singură dată per model**. Adăugarea unei dimensiuni noi nu
presupune rescrierea rețetei.

**Rețeta nu are versiuni și nu se aprobă.** Se editează în loc, de oricine e
autentificat. Ce se pierde odată cu fluxul de aprobare este reproducerea unui bon
din rețetă: dacă cineva schimbă rețeta azi, bonul de luna trecută nu mai poate fi
recalculat din ea. Bonul rămâne însă explicabil singur — fiecare linie păstrează
formula, expresia evaluată și dimensiunile din care a ieșit cantitatea.

### Tipuri de linie de rețetă

| Mod | Cantitatea | Exemplu |
|---|---|---|
| `fixa` | constantă | 4 buc picioare, indiferent de dimensiune |
| `formula` | expresie în L, l, H | `2*(L+l)/1000 * 0.10 * 0.025` → MC cherestea |
| `tabel` | valoare per dimensiune | 1600×2000 → 16 ML; 1400×2000 → 14 ML |

**Modul `tabel` este esențial, nu opțional.** Metrajul de tapițerie nu rezultă geometric —
depinde de croială, de lățimea balotului și de direcția desenului. Tehnologul cunoaște
valoarea din experiență. Sistemul trebuie să o accepte ca atare.

**Override manual**: orice linie poate primi o valoare fixată explicit pentru o dimensiune
anume. Override-ul are prioritate absolută asupra formulei și se afișează vizibil marcat,
cu autorul și motivul.

### Dimensiuni noi

Bonurile se emit **numai pe dimensiuni înregistrate**, fiindcă dimensiunea e cea care
poartă codul de produs finit din SAGA. Când apare o mărime nouă, se adaugă un rând în
tabelul de dimensiuni al modelului — rețeta rămâne aceeași, iar formulele se evaluează
pe noile L, l, H.

**Materiale în trepte.** PAL-ul vine în panouri, stofa în baloturi de lățime fixă.
Se modelează în formulă, cu `ceil`: `ceil(l/1400) * (L+200)/1000` înseamnă „câte lățimi
de balot, ori lungimea fiecăreia". Nu există optimizator de croire și nu se va construi
unul.

O dimensiune nouă începe fără valori pe liniile `tabel` — se completează în coloana ei
din grila de rețete. Lipsa lor e eroare la emiterea bonului, nu zero.

### Grupuri de opțiune

Liniile se grupează: `STRUCTURA`, `TAPITERIE`, `SPUMA`, `ACCESORII`, `AMBALAJ`.

Liniile din `TAPITERIE` sunt marcate `este_variabil = true`: rețeta specifică *metrajul*,
iar codul concret de material se alege la crearea bonului. Astfel același model în
Toscana 247 sau Toscana 257 folosește o singură rețetă.

### Procent de pierderi

Separat de cantitatea netă:

```
cantitate_bruta = cantitate_neta * (1 + procent_pierderi / 100)
```

Se păstrează distinct pentru ca antecalculațiile să separe consumul real de croială.

## 3. Modelul de date

Toate tabelele proprii în schema `public`. Schema `auth` aparține Supabase.

### Utilizatori

Supabase Auth gestionează `auth.users`, parolele, sesiunile, invitațiile și resetarea
parolei. **Nu se reimplementează nimic din toate acestea.**

Aplicația adaugă doar rolul și datele de profil:

```sql
profile
  id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
  nume              text NOT NULL
  rol               text NOT NULL   -- 'admin'|'tehnolog'|'operator'|'contabil'
  activ             boolean NOT NULL DEFAULT true
  creat_de          uuid REFERENCES profile(id)
  creat_la          timestamptz NOT NULL DEFAULT now()
```

Se creează automat printr-un trigger pe `auth.users`, cu rolul luat din
`raw_user_meta_data` la invitație.

**Fluxul de creare a conturilor:**

1. Adminul completează email, nume și rol în ecranul de administrare
2. API-ul apelează `auth.admin.inviteUserByEmail()` cu rolul în metadata
3. Angajatul primește email, apasă linkul, își setează parola
4. Trigger-ul creează rândul din `profile`

Dezactivarea unui cont setează `activ = false` **și** apelează
`auth.admin.updateUserById()` cu `ban_duration`. Fără al doilea pas, sesiunile deja
emise rămân valide.

| Rol | Poate |
|---|---|
| `admin` | tot, plus invitarea și dezactivarea conturilor |
| `tehnolog` | tot, în afară de conturi |
| `operator` | tot, în afară de conturi |
| `contabil` | tot, în afară de conturi |

**Rolul decide un singur lucru: cine administrează conturile.** Fabrica are cinci
oameni care se acoperă unul pe altul; un tehnolog care nu poate emite un bon în ziua
în care operatorul lipsește e o regulă care oprește lucrul, nu una care îl apără.
Conturile rămân la admin fiindcă acolo o greșeală încuie pe cineva afară din propria
unealtă.

### Nomenclator

```sql
saga_article
  cod_saga          text PRIMARY KEY        -- '00023684', text, cu zerouri
  denumire          text NOT NULL
  um                text NOT NULL           -- 'BUC','ML','MC','MP','KG'
  tip               text NOT NULL           -- 'produs'|'materie_prima'
  gestiune_implicita text
  categorie         text                    -- 'TEXTIL','LEMN','SPUMA','FERONERIE'
  pret_referinta    numeric(18,6)
  activ             boolean NOT NULL DEFAULT true
  sincronizat_la    timestamptz

saga_sync
  id, rulat_la, rulat_de, articole_noi, articole_modificate, fisier_nume

unmapped_material
  id, denumire_externa, sugestie_cod_saga, rezolvat, rezolvat_de, rezolvat_la
```

### Modele și dimensiuni

```sql
model
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
  cod               text UNIQUE NOT NULL    -- 'PAT-DAVID'
  denumire          text NOT NULL
  familie           text NOT NULL           -- 'PAT'|'CANAPEA'|'COLTAR'|'SALTEA'
  um_produs         text NOT NULL DEFAULT 'BUC'
  activ             boolean NOT NULL DEFAULT true
  creat_de, creat_la, modificat_la

dimension
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
  model_id          uuid NOT NULL REFERENCES model
  cod               text NOT NULL           -- '2000x1600'
  lungime           numeric(18,6) NOT NULL  -- mm
  latime            numeric(18,6) NOT NULL  -- mm
  inaltime          numeric(18,6)           -- mm, opțional
  cod_saga_produs   text REFERENCES saga_article
  activ             boolean NOT NULL DEFAULT true
  UNIQUE (model_id, cod)
```

**Dimensiunile sunt în milimetri.** Formulele fac explicit conversia către UM-ul
materialului (`/1000` pentru metri).

### Rețete

```sql
recipe
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
  model_id          uuid NOT NULL REFERENCES model
  versiune          integer NOT NULL
  status            text NOT NULL   -- doar 'draft'
  valabil_de_la     date
  aprobat_de        uuid REFERENCES profile(id)
  aprobat_la        timestamptz
  lock_version      integer NOT NULL DEFAULT 0
  creat_de, creat_la
  UNIQUE (model_id, versiune)

CREATE UNIQUE INDEX one_active_recipe_per_model
  ON recipe (model_id) WHERE status = 'activa';

recipe_line
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
  recipe_id         uuid NOT NULL REFERENCES recipe ON DELETE CASCADE
  nr_linie          integer NOT NULL
  grup              text NOT NULL
  cod_saga          text REFERENCES saga_article   -- NULL dacă este_variabil
  este_variabil     boolean NOT NULL DEFAULT false
  categorie_variabila text
  um                text NOT NULL
  mod_calcul        text NOT NULL   -- 'fixa'|'formula'|'tabel'
  cantitate_fixa    numeric(18,6)
  formula           text
  procent_pierderi  numeric(18,6) NOT NULL DEFAULT 0
  gestiune_descarcare text
  obligatoriu       boolean NOT NULL DEFAULT true
  observatii        text
  UNIQUE (recipe_id, nr_linie)

recipe_line_dimension     -- valori pentru mod 'tabel' ȘI override-uri
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
  recipe_line_id    uuid NOT NULL REFERENCES recipe_line ON DELETE CASCADE
  dimension_id      uuid NOT NULL REFERENCES dimension
  cantitate         numeric(18,6) NOT NULL
  este_override     boolean NOT NULL DEFAULT false
  motiv             text
  setat_de          uuid REFERENCES profile(id)
  setat_la          timestamptz
  UNIQUE (recipe_line_id, dimension_id)

recipe_line_alternative
  recipe_line_id, cod_saga, prioritate
```

### Bonuri și export

```sql
production_order
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
  nr_doc            text
  data              date NOT NULL
  gestiune_produs   text NOT NULL
  model_id          uuid NOT NULL REFERENCES model
  dimension_id      uuid NOT NULL REFERENCES dimension
  recipe_id         uuid NOT NULL REFERENCES recipe   -- versiunea, nu modelul
  cod_saga_produs   text NOT NULL REFERENCES saga_article
  cantitate         numeric(18,6) NOT NULL
  pret_prestabilit  numeric(18,6)
  status            text NOT NULL   -- 'draft'|'calculat'|'exportat'|'anulat'
  export_id         uuid REFERENCES export_batch
  creat_de, creat_la

production_order_line
  id, production_order_id, cod_saga, um,
  cantitate_neta    numeric(18,6),
  cantitate_bruta   numeric(18,6),
  sursa             text,   -- 'fixa'|'formula'|'tabel'|'override'|'manual'
  formula_evaluata  text,   -- expresia cu valorile substituite, pentru audit
  gestiune_descarcare text

export_batch
  id, generat_de, generat_la, hash_continut, nr_bonuri, nr_linii,
  storage_path      text    -- calea în bucketul privat din Supabase Storage
```

**Bonul referențiază `recipe_id`, nu `model_id`.** Un bon din iulie rămâne reproductibil
identic chiar dacă rețeta s-a modificat în august.

### Audit

```sql
audit_log
  id                bigserial PRIMARY KEY
  user_id           uuid REFERENCES profile(id)
  entitate          text NOT NULL
  entitate_id       text NOT NULL
  actiune           text NOT NULL
  diff              jsonb
  ip                inet
  creat_la          timestamptz NOT NULL DEFAULT now()
```

Append-only, impus în DB: `REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC` plus politici
RLS care nu permit decât `INSERT`.

## 4. Securitate

- **RLS activat pe fiecare tabel din `public`**, cu politică implicită deny-all.
- API-ul Fastify folosește service role și ocolește RLS. RLS este plasa de siguranță
  pentru cazul în care un tabel ajunge expus din greșeală prin PostgREST.
- `SUPABASE_SERVICE_ROLE_KEY` există **exclusiv** în `apps/api`. Niciodată în frontend,
  niciodată într-o variabilă cu prefix `VITE_`.
- Frontend-ul primește doar `SUPABASE_ANON_KEY` și îl folosește numai pentru autentificare.
- API-ul validează JWT-ul primit de la frontend, apoi citește rolul din `profile`.
  **Rolul nu se citește din token fără verificare** — un token poate fi vechi.
- Fiecare rută verifică rolul explicit. Fără rută publică în afară de health check și login.
- **Autentificarea trece prin API, nu direct din browser în Supabase.** Doar serverul poate
  consemna încercările eșuate — un browser căruia i-a picat login-ul nu are niciun motiv să
  ne anunțe. API-ul folosește cheia anon aici, exact drepturile pe care le-ar fi avut
  browserul, și nu stochează parola nicăieri. Frontend-ul primește sesiunea și de acolo
  clientul Supabase o reînnoiește singur.
- Mesajul de login eșuat nu distinge între „nu există contul" și „parolă greșită".
- Înregistrarea publică este oprită din configurația proiectului (`[auth] enable_signup =
  false`). Conturile apar doar prin invitație.

## 5. Motorul de calcul

Funcție pură, în `packages/shared/src/calcul/`, fără acces la bază de date:

```ts
calculeazaConsumuri(input: {
  reteta: Recipe & { linii: RecipeLine[] },
  dimensiune: DimensiuneCeruta,
  cantitateProdus: Decimal,
  alegeriMateriale: Map<lineId, codSaga>,
}): ConsumLine[]
```

Algoritm, per linie:

1. Există `recipe_line_dimension` cu `este_override = true` pe dimensiunea curentă?
   → folosește acea valoare. **Prioritate absolută.**
2. Altfel, după `mod_calcul`:
   - `fixa` → `cantitate_fixa`
   - `tabel` → valoarea din `recipe_line_dimension`; lipsă → **eroare**, nu zero
   - `formula` → evaluează cu scope `{ L, l, H }`
3. `cantitate_bruta = cantitate_neta * (1 + procent_pierderi/100)`
4. Înmulțește cu `cantitateProdus`
5. Rezolvă codul pentru liniile variabile; lipsă → eroare
6. Agregă liniile cu același `cod_saga`
7. Rotunjește la 3 zecimale **doar la final**

Formule: `expr-eval`, scope explicit `{L, l, H}`, funcții permise doar aritmetice de bază
plus `min`, `max`, `ceil`, `floor`, `round`, `sqrt`. Validare la salvare: parsează, verifică
variabilele, rulează cu valori de test.

## 6. Formatul de export

Un rând per material, agregat pe lotul de bonuri selectate.

| Coloană | Format | Observație |
|---|---|---|
| `Cod` | text (`@`) | **critic** — zerourile din față se pierd altfel |
| `Denumire` | text | verificare vizuală |
| `UM` | text | |
| `Cantitate` | număr, 3 zecimale | |

Fișierul se salvează într-un bucket **privat** din Supabase Storage. Descărcarea se face
prin URL semnat cu expirare scurtă, generat de API după verificarea rolului.

După generare: bonurile primesc `status = 'exportat'` și `export_id`, se salvează hash-ul
conținutului. Un bon deja exportat nu se reexportă fără confirmare explicită.

## 7. Sincronizarea nomenclatorului

Într-un singur sens, prin fișier. Utilizatorul exportă articolele din SAGA în XLSX și le
încarcă. Aplicația face upsert după `cod_saga` și raportează articole noi, modificate,
dispărute. Materialele din rețete fără corespondent ajung în `unmapped_material` și
blochează exportul bonurilor care le folosesc.

## 8. Module, în ordinea implementării

1. **Fundație** — monorepo, Supabase local, migrări, RLS deny-all, audit
2. **Autentificare** — Supabase Auth, profile, roluri, invitații, administrare conturi
3. **Motorul de calcul** — funcție pură, cu teste; independent de DB
4. **Nomenclator** — import articole SAGA, listă, căutare, materiale nemapate
5. **Modele și dimensiuni** — CRUD, legarea de codurile SAGA de produs
6. **Rețetar** — grid editabil, cele trei moduri de calcul, override-uri, validare formule
7. **Bonuri și export XLSX** — previzualizare consumuri, generare, jurnal
8. ~~**Versionare și aprobare**~~ — scos: rețeta se editează în loc
9. **Rapoarte** — antecalculații, necesar de aprovizionare, cost material

Modulele 1–7 formează un produs utilizabil.

## 9. Deployment

- **Bază de date, auth, storage**: un singur proiect Supabase, regiune UE (Frankfurt),
  folosit și pentru dezvoltare, și pentru producție. Nu există stack local — vezi `CLAUDE.md`.
  Planul gratuit suspendă proiectele inactive — pentru producție se folosește plan plătit.
- **Frontend**: Vercel. Primește doar `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
  și `VITE_API_URL`.
- **API**: separat de frontend, pe Railway / Render / Fly, în aceeași regiune cu proiectul
  Supabase, altfel fiecare interogare capătă latență de rețea. Doar aici trăiește
  `SUPABASE_SERVICE_ROLE_KEY`.
- **CORS**: API-ul acceptă explicit originea de pe Vercel, prin `WEB_ORIGIN`. Deploy-urile
  de preview de pe Vercel au domenii care se schimbă — se enumeră explicit, fără wildcard.
- **Migrări**: aplicate prin `supabase db push` din CI, niciodată manual din interfața web.
- **Backup**: Supabase face backup automat, dar suplimentar rulează `pg_dump` săptămânal
  către un storage independent. Un backup pe care nu l-ai restaurat niciodată nu e backup.
- **Secrete**: prin environment. `SUPABASE_SERVICE_ROLE_KEY` niciodată în repo.
