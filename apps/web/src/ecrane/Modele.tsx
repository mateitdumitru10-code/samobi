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

  const filtrate = (modele.data ?? []).filter((m) => {
    const text = cauta.trim().toLowerCase()
    return text === '' || m.denumire.toLowerCase().includes(text) || m.cod.toLowerCase().includes(text)
  })

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap gap-6">
        <div className="w-full space-y-3 lg:max-w-xs">
          <FormularModel />

          <input
            value={cauta}
            onChange={(e) => setCauta(e.target.value)}
            placeholder="Caută model…"
            aria-label="Caută model"
            className="camp"
          />

          <div className="overflow-hidden rounded-lg border border-line bg-surface">
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
                    className={
                      selectat === m.id
                        ? 'w-full border-l-2 border-brand bg-brand-subtle px-4 py-3 text-left'
                        : 'w-full border-l-2 border-transparent px-4 py-3 text-left hover:bg-surface-page'
                    }
                  >
                    <span className="block text-sm font-medium text-ink">{m.denumire}</span>
                    <span className="block font-mono text-xs text-ink-muted">{m.cod}</span>
                    <span className="mt-1 block text-xs text-ink-muted">
                      {m.familie} · {m.nrDimensiuni} dimensiuni
                      {m.nrRetete === 0 && <span className="text-atentie"> · fără rețetă</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {!modele.isLoading && !modele.isError && filtrate.length === 0 && (
              <Gol
                titlu={cauta === '' ? 'Niciun model încă' : 'Niciun model găsit'}
                indiciu={
                  cauta === '' ? 'Începe cu unul, în formularul de deasupra.' : `Nimic pentru „${cauta}".`
                }
              />
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {selectat === null ? (
            <Gol
              titlu="Alege un model din stânga"
              indiciu="Ca să-i vezi dimensiunile, rețeta și versiunile."
            />
          ) : (
            <DetaliuModel modelId={selectat} onModificat={onModificat} />
          )}
        </div>
      </div>
    </section>
  )
}

function FormularModel() {
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
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">{detaliu.data.denumire}</h2>
        <p className="font-mono text-xs text-ink-muted">{detaliu.data.cod}</p>
      </div>

      <Dimensiuni modelId={modelId} dimensiuni={detaliu.data.dimensiuni} />

      <div>
        <h3 className="mb-3 text-sm font-semibold text-ink">Rețetă</h3>
        <RetetaEditor modelId={modelId} onModificat={onModificat} />
      </div>
    </div>
  )
}

function Dimensiuni({ modelId, dimensiuni }: { modelId: string; dimensiuni: Dimensiune[] }) {
  const queryClient = useQueryClient()
  const notificari = useNotificari()
  const [deschis, setDeschis] = useState(false)
  const [cod, setCod] = useState('')
  const [lungime, setLungime] = useState('')
  const [latime, setLatime] = useState('')
  const [inaltime, setInaltime] = useState('')
  const [produs, setProdus] = useState<{ codSaga: string; denumire: string } | null>(null)

  const creeaza = useMutation({
    mutationFn: () =>
      apel(`/modele/${modelId}/dimensiuni`, {
        metoda: 'POST',
        corp: {
          cod,
          lungime,
          latime,
          inaltime: inaltime === '' ? null : inaltime,
          codSagaProdus: produs?.codSaga ?? null,
        },
      }),
    onSuccess: async () => {
      notificari.succes(`Dimensiunea ${cod} a fost adăugată.`)
      setCod('')
      setLungime('')
      setLatime('')
      setInaltime('')
      setProdus(null)
      setDeschis(false)
      await queryClient.invalidateQueries({ queryKey: ['model', modelId] })
      await queryClient.invalidateQueries({ queryKey: ['reteta', modelId] })
    },
    onError: (e) => notificari.eroare(mesajEroare(e)),
  })

  function trimite(eveniment: FormEvent) {
    eveniment.preventDefault()
    creeaza.mutate()
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">Dimensiuni</h3>
          <p className="text-sm text-ink-muted">
            Bonurile se emit pe dimensiunile de aici. Pentru o mărime nouă, adaug-o —
            rețeta rămâne aceeași.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDeschis((d) => !d)}
          className="buton buton-secundar buton-mic"
        >
          {deschis ? 'Renunță' : 'Adaugă dimensiune'}
        </button>
      </div>

      {deschis && (
        <form onSubmit={trimite} className="card mb-3 flex flex-wrap items-end gap-3 p-4">
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

          <button type="submit" disabled={creeaza.isPending} className="buton buton-primar">
            Adaugă
          </button>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm" aria-label="Dimensiunile modelului">
          <thead className="bg-surface-sunken text-left text-xs uppercase text-ink-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Cod
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                L × l × H (mm)
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Produs finit în SAGA
              </th>
            </tr>
          </thead>
          <tbody>
            {dimensiuni.map((d) => (
              <tr key={d.id} className="border-t border-line hover:bg-surface-page">
                <td className="px-4 py-2 font-medium">{d.cod}</td>
                <td className="px-4 py-2 tabular-nums text-ink-secondary">
                  {mm(d.lungime)} × {mm(d.latime)}
                  {d.inaltime !== null && ` × ${mm(d.inaltime)}`}
                </td>
                <td className="px-4 py-2 text-ink-secondary">
                  {d.codSagaProdus === null ? (
                    <Insigna fel="atentie">nelegat — bonul nu se poate emite</Insigna>
                  ) : (
                    <>
                      <span className="font-mono text-xs">{d.codSagaProdus}</span>
                      {d.denumireProdus !== null && (
                        <span className="ml-2 text-ink-muted">{d.denumireProdus}</span>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {dimensiuni.length === 0 && (
              <tr>
                <td colSpan={3}>
                  <Gol
                    titlu="Nicio dimensiune"
                    indiciu="Rețeta are nevoie de cel puțin una: formulele se evaluează pe L, l și H."
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
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
