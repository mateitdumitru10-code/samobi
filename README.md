# samobi

Aplicație internă de gestiune a rețetelor de producție pentru mobilier tapițat, cu export
XLSX către ecranul `Producție` din SAGA.

- `docs/SPEC.md` — specificația funcțională
- `CLAUDE.md` — regulile tehnice obligatorii
- `docs/PROMPTURI.md` — ordinea de implementare a modulelor

## Structură

```
apps/api          Fastify, Node ≥22 — singurul loc unde trăiește service role key
apps/web          React 19 + Vite — primește doar anon key
packages/shared   schema Drizzle, scheme Zod, motorul de calcul (funcții pure)
supabase/         config + migrări
```

## Pornire

```bash
pnpm install
cp .env.example apps/api/.env          # completează cu datele din Supabase Dashboard
cp apps/web/.env.example apps/web/.env
pnpm dev                                # api :3000, web :5173
```

Nu există stack Supabase local. Baza de date este proiectul din cloud — detalii și
consecințe în `CLAUDE.md`, secțiunea „Fără stack local".

## Comenzi

```bash
pnpm dev          # api + web
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm db:generate  # drizzle-kit generate — SQL din schema TypeScript
pnpm db:push      # supabase db push — aplică migrările în cloud
```
