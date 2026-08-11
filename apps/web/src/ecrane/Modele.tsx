import { FAMILII } from '@samobi/shared/db'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState, type FormEvent } from 'react'

import { apel } from '../lib/api.js'
import { CautaArticol } from '../ui/CautaArticol.js'
import { useNotificari } from '../ui/Notificari.js'
import { BannerEroare, Gol, Insigna, Schelet, mesajEroare } from '../ui/stari.js'

import { RetetaEditor } from './RetetaEditor.js'

interface RandModel {
  id: string
  cod: string
  denumire: string
  familie: string
  umProdus: string
  activ: boolean
  nrDimensiuni: number
  nrRetete: number
}

interface Dimensiune {
  id: string
  cod: string
  lungime: string
  latime: string
  inaltime: string | null
  codSagaProdus: string | null
  denumireProdus: string | null
  activ: boolean
}

interface Detaliu extends RandModel {
  dimensiuni: Dimensiune[]
}

/** Trailing zeros from numeric(18,6) help nobody read 2000.000000. */
function mm(valoare: string | null): string {
  if (valoare === null) return '—'
  return String(Number(valoare))
}

export function Modele() {
  const [selectat, setSelectat] = useState<string | null>(null)
  const [cauta, setCauta] = useState('')
  const [familie, setFamilie] = useState<string | null>(null)
  const [formularDeschis, setFormularDeschis] = useState(false)
  // Raised by the recipe editor. Switching models unmounts it, and forty
  // transcribed lines used to go with it without a word.
  const [areModificari, setAreModificari] = useState(false)

  const modele = useQuery({
    queryKey: ['modele'],
    queryFn: () => apel<RandModel[]>('/modele'),
  })

  const onModificat = useCallback((m: boolean) => setAreModificari(m), [])

  function alege(id: string) {
    if (id === selectat) return
    if (
      areModificari &&
      !window.confirm(
        'Ai modificări nesalvate la rețeta acestui model. Le pierzi dacă treci la altul.',
      )
    ) {
      return
    }
    setAreModificari(false)
    setSelectat(id)
  }

  const toate = modele.data ?? []

  const familii = [...new Set(toate.map((m) => m.familie))]
    .map((nume) => ({ nume, n: toate.filter((m) => m.familie === nume).length }))
    .sort((a, b) => b.n - a.n)

  const filtrate = toate.filter((m) => {
    const text = cauta.trim().toLowerCase()
    const potriveste =
      text === '' || m.denumire.toLowerCase().includes(text) || m.cod.toLowerCase().includes(text)
    return potriveste && (familie === null || m.familie === familie)
  })

  return (
    /*
     * Two panes, each scrolling on its own, instead of one page that grows with
     * ninety-eight models on top of a forty-line recipe. Picking the next model
     * used to mean scrolling back up past the whole grid.
     */
    <section className="flex flex-col gap-4 lg:h-[calc(100vh-9.5rem)] lg:min-h-[34rem] lg:flex-row">
      <div className="flex w-full shrink-0 flex-col gap-2 lg:w-72">
        <div className="flex gap-2">
          <input
            value={cauta}
            onChange={(e) => setCauta(e.target.value)}
            placeholder="Caută model…"
            aria-label="Caută model"
            className="camp camp-mic"
          />
          <button
            type="button"
            onClick={() => setFormularDeschis((d) => !d)}
            aria-expanded={formularDeschis}
            title="Model nou"
            className="buton buton-secundar buton-mic shrink-0"
          >
            {formularDeschis ? 'Renunță' : '+ Model'}
          </button>
        </div>

        {formularDeschis && <FormularModel onGata={() => setFormularDeschis(false)} />}

        <div className="flex flex-wrap gap-1">
          {familii.map((f) => (
            <button
              key={f.nume}
              type="button"
              onClick={() => setFamilie((curenta) => (curenta === f.nume ? null : f.nume))}
              aria-pressed={familie === f.nume}
              className={`insigna ${
                familie === f.nume
                  ? 'border-brand bg-brand text-white'
                  : 'border-line-strong bg-surface text-ink-secondary hover:bg-surface-sunken'
              }`}
            >
              {f.nume} <span className={familie === f.nume ? '' : 'text-ink-muted'}>{f.n}</span>
            </button>
          ))}
        </div>

        <div className="max-h-72 min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-surface lg:max-h-none">
          {modele.isLoading && (
            <div className="space-y-2 p-4">
              <Schelet className="h-4 w-40" />
              <Schelet className="h-4 w-32" />
              <Schelet className="h-4 w-36" />
            </div>
          )}

          {modele.isError && (
            <div className="p-3">
              <BannerEroare
                eroare={modele.error}
                titlu="Modelele nu s-au putut încărca."
                onReincearca={() => void modele.refetch()}
              />
            </div>
          )}

          <ul className="divide-y divide-line">
            {filtrate.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => alege(m.id)}
                  aria-current={selectat === m.id ? 'true' : undefined}
                  title={`${m.cod} · ${m.familie}`}
                  className={
                    selectat === m.id
                      ? 'flex w-full items-center gap-2 border-l-2 border-brand bg-brand-subtle px-3 py-2 text-left'
                      : 'flex w-full items-center gap-2 border-l-2 border-transparent px-3 py-2 text-left hover:bg-surface-page'
                  }
                >
                  {/* One line per model: the code and the family are on the row
                      that is selected anyway, and three lines × 98 models is the
                      scroll this screen was drowning in. */}
                  <span className="truncate text-sm text-ink">{m.denumire}</span>
                  {m.nrRetete === 0 && (
                    <span className="ml-auto shrink-0 text-xs text-atentie">fără rețetă</span>
                  )}
                  {m.nrDimensiuni === 0 && (
                    <span className="ml-auto shrink-0 text-xs text-atentie">fără dimensiune</span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {!modele.isLoading && !modele.isError && filtrate.length === 0 && (
            <Gol
              titlu="Niciun model găsit"
              indiciu={cauta === '' ? 'Adaugă unul cu „+ Model".' : `Nimic pentru „${cauta}".`}
            />
          )}
        </div>

        <p className="text-xs text-ink-muted">
          {filtrate.length} din {modele.data?.length ?? 0} modele
        </p>
      </div>

      <div className="min-w-0 flex-1 lg:overflow-y-auto lg:pr-1">
        {selectat === null ? (
          <Gol titlu="Alege un model din stânga" indiciu="Ca să-i vezi dimensiunile și rețeta." />
        ) : (
          /*
           * Keyed by the model, so switching remounts everything under it.
           * Without this the pane keeps its state whenever the next model is
           * already cached — which is the normal case here — and an edited
           * grid, or a half-typed dimension, ends up pointed at the wrong
           * model. The recipe editor would then save model A's lines onto
           * model B, and with equal lock versions it would not even conflict.
           */
          <DetaliuModel key={selectat} modelId={selectat} onModificat={onModificat} />
        )}
      </div>
    </section>
  )
}

function FormularModel({ onGata }: { onGata: () => void }) {
  const queryClient = useQueryClient()
  const notificari = useNotificari()
  const [cod, setCod] = useState('')
  const [denumire, setDenumire] = useState('')
  const [familie, setFamilie] = useState<string>('PAT')

  const creeaza = useMutation({
    mutationFn: () => apel('/modele', { metoda: 'POST', corp: { cod, denumire, familie } }),
    onSuccess: async () => {
      notificari.succes(`Modelul ${cod} a fost creat.`)
      setCod('')
      setDenumire('')
      onGata()
      await queryClient.invalidateQueries({ queryKey: ['modele'] })
    },
    onError: (e) => notificari.eroare(mesajEroare(e)),
  })

  function trimite(eveniment: FormEvent) {
    eveniment.preventDefault()
    creeaza.mutate()
  }

  return (
    <form onSubmit={trimite} className="card space-y-3 p-4">
      <h2 className="text-sm font-semibold text-ink">Model nou</h2>

      <div>
        <label htmlFor="cod-model" className="eticheta">
          Cod
        </label>
        <input
          id="cod-model"
          value={cod}
          onChange={(e) => setCod(e.target.value.toUpperCase())}
          placeholder="PAT-DAVID"
          required
          className="camp font-mono"
        />
      </div>

      <div>
        <label htmlFor="denumire-model" className="eticheta">
          Denumire
        </label>
        <input
          id="denumire-model"
          value={denumire}
          onChange={(e) => setDenumire(e.target.value)}
          placeholder="PAT DAVID SOMIERA"
          required
          className="camp"
        />
      </div>

      <div>
        <label htmlFor="familie-model" className="eticheta">
          Familie
        </label>
        <select
          id="familie-model"
          value={familie}
          onChange={(e) => setFamilie(e.target.value)}
          className="camp"
        >
          {FAMILII.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      <button type="submit" disabled={creeaza.isPending} className="buton buton-primar w-full">
        {creeaza.isPending ? 'Se creează…' : 'Creează modelul'}
      </button>
    </form>
  )
}

function DetaliuModel({
  modelId,
  onModificat,
}: {
  modelId: string
  onModificat: (modificat: boolean) => void
}) {
  const detaliu = useQuery({
    queryKey: ['model', modelId],
    queryFn: () => apel<Detaliu>(`/modele/${modelId}`),
  })

  if (detaliu.isLoading) {
    return (
      <div className="space-y-3">
        <Schelet className="h-6 w-64" />
        <Schelet className="h-32 w-full" />
      </div>
    )
  }

  if (detaliu.isError) {
    return (
      <BannerEroare
        eroare={detaliu.error}
        titlu="Modelul nu s-a putut încărca."
        onReincearca={() => void detaliu.refetch()}
      />
    )
  }

  if (detaliu.data === undefined) return null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-lg font-semibold text-ink">{detaliu.data.denumire}</h2>
        <span className="font-mono text-xs text-ink-muted">{detaliu.data.cod}</span>
        <span className="text-xs text-ink-muted">{detaliu.data.familie}</span>
      </div>

      <Dimensiuni modelId={modelId} dimensiuni={detaliu.data.dimensiuni} />

      <RetetaEditor modelId={modelId} onModificat={onModificat} />
    </div>
  )
}

/**
 * The sizes a model is built in.
 *
 * Editable after the fact, and deliberately so: a size gets entered as whatever
 * the first bon needed, and the real standard shows up later. The measurements
 * do freeze once a bon has been issued against them — the API refuses that, and
 * rightly: the consumptions on that bon were computed from those numbers. The
 * label and the SAGA article stay editable in every case; they name the thing,
 * they are not inputs to the calculation.
 */
function Dimensiuni({ modelId, dimensiuni }: { modelId: string; dimensiuni: Dimensiune[] }) {
  const queryClient = useQueryClient()
  const notificari = useNotificari()
  /** null = closed, 'nou' = the add form, otherwise the id being edited. */
  const [deschis, setDeschis] = useState<string | null>(null)

  const active = dimensiuni.filter((d) => d.activ)
  const inactive = dimensiuni.filter((d) => !d.activ)

  const reimprospateaza = async () => {
    await queryClient.invalidateQueries({ queryKey: ['model', modelId] })
    await queryClient.invalidateQueries({ queryKey: ['reteta', modelId] })
  }

  const reactiveaza = useMutation({
    mutationFn: (id: string) =>
      apel(`/modele/${modelId}/dimensiuni/${id}`, { metoda: 'PATCH', corp: { activ: true } }),
    onSuccess: reimprospateaza,
    onError: (e) => notificari.eroare(mesajEroare(e)),
  })

  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-xs font-medium uppercase text-ink-muted">Dimensiuni</span>

        {/* Ninety-six of ninety-eight models have exactly one. A table with a
            header row, for one row of data, above the thing actually being
            edited. */}
        {active.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setDeschis((curent) => (curent === d.id ? null : d.id))}
            aria-expanded={deschis === d.id}
            title="Modifică dimensiunea"
            className={`flex items-center gap-2 rounded-md px-2 py-0.5 text-left ${
              deschis === d.id ? 'bg-brand-subtle' : 'hover:bg-surface-sunken'
            }`}
          >
            <span className="font-medium text-ink">{d.cod}</span>
            <span className="tabular-nums text-ink-secondary">
              {mm(d.lungime)}×{mm(d.latime)}
              {d.inaltime !== null && `×${mm(d.inaltime)}`}
            </span>
            {d.codSagaProdus === null ? (
              <Insigna fel="atentie">fără produs finit — bonul nu se poate emite</Insigna>
            ) : (
              <span
                className="font-mono text-xs text-ink-muted"
                title={d.denumireProdus ?? undefined}
              >
                {d.codSagaProdus}
              </span>
            )}
          </button>
        ))}

        {active.length === 0 && (
          <span className="text-atentie">
            niciuna — rețeta are nevoie de cel puțin una ca să se emită bonuri
          </span>
        )}

        {inactive.map((d) => (
          <span key={d.id} className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span className="line-through">{d.cod}</span>
            <button
              type="button"
              disabled={reactiveaza.isPending}
              onClick={() => reactiveaza.mutate(d.id)}
              className="text-brand underline underline-offset-2"
            >
              reactivează
            </button>
          </span>
        ))}

        <button
          type="button"
          onClick={() => setDeschis((curent) => (curent === 'nou' ? null : 'nou'))}
          className="ml-auto text-xs text-brand underline underline-offset-2"
        >
          {deschis === 'nou' ? 'renunță' : '+ adaugă'}
        </button>
      </div>

      {deschis === 'nou' && (
        <FormaDimensiune
          modelId={modelId}
          onGata={() => setDeschis(null)}
          onSalvat={reimprospateaza}
        />
      )}
      {active
        .filter((d) => d.id === deschis)
        .map((d) => (
          <FormaDimensiune
            key={d.id}
            modelId={modelId}
            dimensiune={d}
            onGata={() => setDeschis(null)}
            onSalvat={reimprospateaza}
          />
        ))}
    </div>
  )
}

function FormaDimensiune({
  modelId,
  dimensiune,
  onGata,
  onSalvat,
}: {
  modelId: string
  /** absent when adding */
  dimensiune?: Dimensiune
  onGata: () => void
  onSalvat: () => Promise<void>
}) {
  const notificari = useNotificari()
  const [cod, setCod] = useState(dimensiune?.cod ?? '')
  const [lungime, setLungime] = useState(dimensiune === undefined ? '' : mm(dimensiune.lungime))
  const [latime, setLatime] = useState(dimensiune === undefined ? '' : mm(dimensiune.latime))
  const [inaltime, setInaltime] = useState(
    dimensiune?.inaltime == null ? '' : mm(dimensiune.inaltime),
  )
  const [produs, setProdus] = useState<{ codSaga: string; denumire: string } | null>(
    dimensiune?.codSagaProdus == null
      ? null
      : { codSaga: dimensiune.codSagaProdus, denumire: dimensiune.denumireProdus ?? '' },
  )

  const esteNoua = dimensiune === undefined

  const salveaza = useMutation({
    mutationFn: () =>
      apel(
        esteNoua
          ? `/modele/${modelId}/dimensiuni`
          : `/modele/${modelId}/dimensiuni/${dimensiune.id}`,
        {
          metoda: esteNoua ? 'POST' : 'PATCH',
          corp: {
            cod,
            lungime,
            latime,
            inaltime: inaltime === '' ? null : inaltime,
            // '' clears it server-side; null would mean „nu schimba" on a PATCH.
            codSagaProdus: produs?.codSaga ?? (esteNoua ? null : ''),
          },
        },
      ),
    onSuccess: async () => {
      notificari.succes(
        esteNoua ? `Dimensiunea ${cod} a fost adăugată.` : `Dimensiunea ${cod} a fost salvată.`,
      )
      onGata()
      await onSalvat()
    },
    onError: (e) => notificari.eroare(mesajEroare(e)),
  })

  const dezactiveaza = useMutation({
    mutationFn: () =>
      apel(`/modele/${modelId}/dimensiuni/${dimensiune?.id ?? ''}`, {
        metoda: 'PATCH',
        corp: { activ: false },
      }),
    onSuccess: async () => {
      notificari.succes(`Dimensiunea ${cod} a fost dezactivată.`)
      onGata()
      await onSalvat()
    },
    onError: (e) => notificari.eroare(mesajEroare(e)),
  })

  return (
    <form
      onSubmit={(eveniment) => {
        eveniment.preventDefault()
        salveaza.mutate()
      }}
      className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3"
    >
      <Camp eticheta="Cod" valoare={cod} set={setCod} latime="w-32" placeholder="2000x1600" />
      <Camp
        eticheta="Lungime (mm)"
        valoare={lungime}
        set={setLungime}
        latime="w-28"
        placeholder="2000"
      />
      <Camp
        eticheta="Lățime (mm)"
        valoare={latime}
        set={setLatime}
        latime="w-28"
        placeholder="1600"
      />
      <Camp
        eticheta="Înălțime (mm)"
        valoare={inaltime}
        set={setInaltime}
        latime="w-28"
        placeholder="350"
        optional
      />

      <div>
        <span className="eticheta">Produs finit în SAGA</span>
        {produs === null ? (
          <CautaArticol
            clasa="camp w-72"
            placeholder="caută produsul finit…"
            onAlege={(a) => setProdus({ codSaga: a.codSaga, denumire: a.denumire })}
          />
        ) : (
          <span className="flex h-10 items-center gap-2 text-sm">
            <span className="font-mono text-xs">{produs.codSaga}</span>
            <span className="text-ink">{produs.denumire}</span>
            <button
              type="button"
              onClick={() => setProdus(null)}
              className="text-xs text-brand underline underline-offset-2"
            >
              schimbă
            </button>
          </span>
        )}
      </div>

      <button type="submit" disabled={salveaza.isPending} className="buton buton-primar">
        {salveaza.isPending ? 'Se salvează…' : esteNoua ? 'Adaugă' : 'Salvează'}
      </button>

      {!esteNoua && (
        <button
          type="button"
          disabled={dezactiveaza.isPending}
          onClick={() => dezactiveaza.mutate()}
          className="buton buton-pericol buton-mic"
        >
          Dezactivează
        </button>
      )}

      {!esteNoua && (
        <p className="w-full text-xs text-ink-muted">
          Măsurile se pot schimba cât timp nu s-a emis niciun bon pe dimensiunea asta. După primul
          bon rămân doar codul și produsul finit — consumurile de pe bon s-au calculat din ele.
        </p>
      )}
    </form>
  )
}

function Camp({
  eticheta,
  valoare,
  set,
  latime,
  placeholder,
  optional,
}: {
  eticheta: string
  valoare: string
  set: (v: string) => void
  latime: string
  placeholder: string
  optional?: boolean
}) {
  return (
    <label className="block">
      <span className="eticheta">{eticheta}</span>
      <input
        value={valoare}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        required={optional !== true}
        className={`camp ${latime}`}
      />
    </label>
  )
}
