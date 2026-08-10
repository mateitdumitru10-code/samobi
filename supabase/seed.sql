-- Date de exemplu din docs/SPEC.md. Codurile SAGA sunt reale: verificate in
-- exportul de nomenclator, cu aceeasi denumire si aceeasi unitate de masura.
--
-- Idempotent. Nu se aplica automat -- proiectul Supabase este si cel de
-- productie, deci rularea se face deliberat, cu `pnpm db:seed`.

-- ---------------------------------------------------------------------------
-- Nomenclator
-- ---------------------------------------------------------------------------

insert into public.saga_article
  (cod_saga, denumire, um, um_normalizat, tip, tip_saga, cont, gestiune_implicita, categorie, activ)
values
  ('00023684', 'TOSCANA 247',                 'ML',  'ML',  'materie_prima', 'Materii prime',  '301', 'MATERII PRIME', 'TEXTIL', true),
  ('00023879', 'TOSCANA 257',                 'ML',  'ML',  'materie_prima', 'Materii prime',  '301', 'MATERII PRIME', 'TEXTIL', true),
  ('00016024', 'CHERESTEA TIVITA FAG',        'MC',  'MC',  'materie_prima', 'Materii prime',  '301', 'MATERII PRIME', 'LEMN',   true),
  ('00024369', 'CHERESTEA TIVITA PIN',        'MC',  'MC',  'materie_prima', 'Materii prime',  '301', 'MATERII PRIME', 'LEMN',   true),
  ('00022107', 'PAT DAVID SOMIERA 2000/1600', 'BUC', 'BUC', 'produs',        'Produse finite', '345', 'MATERII PRIME', null,     true),
  ('00024377', 'COLTAR ECO II FARA TABURET',  'BUC', 'BUC', 'produs',        'Produse finite', '345', 'MATERII PRIME', null,     true)
on conflict (cod_saga) do nothing;

-- ---------------------------------------------------------------------------
-- Modele si dimensiuni
-- ---------------------------------------------------------------------------

insert into public.model (id, cod, denumire, familie, um_produs, activ)
values
  ('11111111-1111-4111-8111-111111111111', 'PAT-DAVID',     'PAT DAVID SOMIERA',          'PAT',    'BUC', true),
  ('22222222-2222-4222-8222-222222222222', 'COLTAR-ECO-II', 'COLTAR ECO II FARA TABURET', 'COLTAR', 'BUC', true)
on conflict (cod) do nothing;

insert into public.dimension (id, model_id, cod, lungime, latime, inaltime, cod_saga_produs, activ)
values
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111',
   '2000x1600', 2000, 1600, 350, '00022107', true),
  ('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111',
   '1900x1400', 1900, 1400, 350, null, true),
  ('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222',
   'STANDARD', 2600, 1800, 850, '00024377', true)
on conflict (model_id, cod) do nothing;

-- ---------------------------------------------------------------------------
-- Reteta PAT-DAVID: mod formula
-- ---------------------------------------------------------------------------

insert into public.recipe (id, model_id, versiune, status, valabil_de_la)
values ('cccccccc-1111-4111-8111-cccccccccccc', '11111111-1111-4111-8111-111111111111',
        1, 'activa', current_date)
on conflict (model_id, versiune) do nothing;

insert into public.recipe_line
  (id, recipe_id, nr_linie, grup, cod_saga, este_variabil, categorie_variabila, um,
   mod_calcul, cantitate_fixa, formula, procent_pierderi, gestiune_descarcare, observatii)
values
  ('dddddddd-1111-4111-8111-dddddddddddd', 'cccccccc-1111-4111-8111-cccccccccccc',
   1, 'STRUCTURA', '00016024', false, null, 'MC',
   'formula', null, '2*(L+l)/1000 * 0.10 * 0.025', 8, 'MATERII PRIME',
   'Perimetru x sectiune. Exemplu din spec.'),
  ('dddddddd-2222-4222-8222-dddddddddddd', 'cccccccc-1111-4111-8111-cccccccccccc',
   2, 'TAPITERIE', null, true, 'TEXTIL', 'ML',
   'tabel', null, null, 5, 'MATERII PRIME',
   'Metrajul depinde de croiala, nu de geometrie.')
on conflict (recipe_id, nr_linie) do nothing;

-- Valori de tabel pentru linia de tapiterie, si un override peste formula.
insert into public.recipe_line_dimension
  (recipe_line_id, dimension_id, cantitate, este_override, motiv, setat_de, setat_la)
values
  ('dddddddd-2222-4222-8222-dddddddddddd', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
   16, false, null, null, null),
  ('dddddddd-2222-4222-8222-dddddddddddd', 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',
   14, false, null, null, null)
on conflict (recipe_line_id, dimension_id) do nothing;

-- ---------------------------------------------------------------------------
-- Reteta COLTAR-ECO-II: mod tabel si mod fixa
-- ---------------------------------------------------------------------------

insert into public.recipe (id, model_id, versiune, status, valabil_de_la)
values ('cccccccc-2222-4222-8222-cccccccccccc', '22222222-2222-4222-8222-222222222222',
        1, 'activa', current_date)
on conflict (model_id, versiune) do nothing;

insert into public.recipe_line
  (id, recipe_id, nr_linie, grup, cod_saga, este_variabil, categorie_variabila, um,
   mod_calcul, cantitate_fixa, formula, procent_pierderi, gestiune_descarcare, observatii)
values
  ('eeeeeeee-1111-4111-8111-eeeeeeeeeeee', 'cccccccc-2222-4222-8222-cccccccccccc',
   1, 'TAPITERIE', null, true, 'TEXTIL', 'ML', 'tabel', null, null, 5, 'MATERII PRIME',
   'Stofa principala, 16 ML pe dimensiunea standard.'),
  ('eeeeeeee-2222-4222-8222-eeeeeeeeeeee', 'cccccccc-2222-4222-8222-cccccccccccc',
   2, 'TAPITERIE', null, true, 'TEXTIL', 'ML', 'tabel', null, null, 5, 'MATERII PRIME',
   'Stofa secundara.'),
  ('eeeeeeee-3333-4333-8333-eeeeeeeeeeee', 'cccccccc-2222-4222-8222-cccccccccccc',
   3, 'STRUCTURA', '00016024', false, null, 'MC', 'fixa', 0.04, null, 0, 'MATERII PRIME', null),
  ('eeeeeeee-4444-4444-8444-eeeeeeeeeeee', 'cccccccc-2222-4222-8222-cccccccccccc',
   4, 'STRUCTURA', '00024369', false, null, 'MC', 'fixa', 0.04, null, 0, 'MATERII PRIME', null)
on conflict (recipe_id, nr_linie) do nothing;

insert into public.recipe_line_dimension
  (recipe_line_id, dimension_id, cantitate, este_override, motiv, setat_de, setat_la)
values
  ('eeeeeeee-1111-4111-8111-eeeeeeeeeeee', 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', 16, false, null, null, null),
  ('eeeeeeee-2222-4222-8222-eeeeeeeeeeee', 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', 2,  false, null, null, null)
on conflict (recipe_line_id, dimension_id) do nothing;
