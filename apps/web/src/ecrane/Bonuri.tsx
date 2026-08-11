import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { apel, EroareApi } from '../lib/api.js'
import { AlegeStofe, type StofaSuplimentara } from '../ui/AlegeStofe.js'
import { CautaArticol, type ArticolGasit } from '../ui/CautaArticol.js'
import { useNotificari } from '../ui/Notificari.js'
import { cant, dataRo, normalizeazaZecimala } from '../ui/numere.js'
import {
  BannerEroare,
  Confirma,
  Gol,
  Insigna,
  RanduriSchelet,
  RandStare,
  mesajEroare,
} from '../ui/stari.js'

interface RandModel {
  id: string
  cod: string
  denumire: string
  nrDimensiuni: number
}

interface Dimensiune {
  id: string
  cod: string
  lungime: string
  latime: string
  inaltime: string | null
  codSagaProdus: string | null
}

interface Context {
  dimensiuni: Dimensiune[]
  liniiVariabile: LinieVariabila[]
}

interface LinieVariabila {
  id: string
  nrLinie: number
  grup: string
  um: string
  cantitate: string | null
  categorieVariabila: string | null
  stofaAnterioaraCod: string | null
  stofaAnterioaraDenumire: string | null
}

interface Consum {
  codSaga: string
  denumire: string
  um: string
  gestiuneDescarcare: string | null
  cantitateNeta: string
  cantitateBruta: string
  cantitateBrutaRotunjita: string
  sursa: string
}

interface RandBon {
  id: string
  nrDoc: string | null
  data: string
  cantitate: string
  status: string
  modelCod: string
  modelDenumire: string
  dimensiuneCod: string
  codSagaProdus: string
  denumireProdus: string | null
}

interface LinieBon {
  codSaga: string
  denumire: string | null
  um: string
  cantitateNeta: string
  cantitateBruta: string
  sursa: string
  gestiuneDescarcare: string | null
}

const ETICHETE_STATUS: Record<string, { text: string; fel: 'succes' | 'info' | 'neutru' }> = {
  calculat: { text: 'De exportat', fel: 'info' },
  draft: { text: 'Draft', fel: 'neutru' },
  exportat: { text: 'Exportat', fel: 'succes' },
  anulat: { text: 'Anulat', fel: 'neutru' },
}

const ETICHETE_SURSA: Record<string, string> = {
  fixa: 'fixă',
  formula: 'formulă',
  tabel: 'tabel',
  override: 'fixată manual',
  manual: 'metraj scris pe bon',
  agregat: 'agregat',
}

const GESTIUNE_IMPLICITA = 'MATERII PRIME'

export function Bonuri() {
  return (
    <section className="space-y-8">
      <BonNou />
      <ListaBonuri />
    </section>
  )
}

function BonNou() {
  const queryClient = useQueryClient()
  const notificari = useNotificari()
  const [modelId, setModelId] = useState('')
  const [dimensiuneId, setDimensiuneId] = useState('')
  const [cantitate, setCantitate] = useState('1')
  // Computed on mount, not at module load: a tab left open overnight used to
  // propose yesterday.
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
  const [nrDoc, setNrDoc] = useState('')
  const [gestiuneProdus, setGestiuneProdus] = useState(
    () => localStorage.getItem('samobi:gestiune-produs') ?? GESTIUNE_IMPLICITA,
  )
  const [alegeri, setAlegeri] = useState<Record<string, ArticolGasit>>({})
  // Only the lines whose metreage was typed over. Absent means „ca în rețetă",
  // which is what the bon should say when nobody touched it.
  const [cantitatiLinii, setCantitatiLinii] = useState<Record<string, string>>({})
  // Lines the recipe has and this bon does not use, and materials the other way
  // round. Both are facts about the order; the recipe stays as it is.
  const [liniiExcluse, setLiniiExcluse] = useState<string[]>([])
  const [suplimentare, setSuplimentare] = useState<StofaSuplimentara[]>([])
  const [salvat, setSalvat] = useState<{ cantitate: string; linii: Consum[] } | null>(null)
  const refCantitate = useRef<HTMLInputElement>(null)

  const modele = useQuery({
    queryKey: ['modele'],
    queryFn: () => apel<RandModel[]>('/modele'),
  })

  const context = useQuery({
    queryKey: ['bon-context', modelId, dimensiuneId],
    queryFn: () =>
      apel<Context>(
        `/bonuri/context/${modelId}${dimensiuneId === '' ? '' : `?dimensiuneId=${dimensiuneId}`}`,
      ),
    enabled: modelId !== '',
  })

  const gestiuni = useQuery({
    queryKey: ['nomenclator-filtre'],
    queryFn: () => apel<{ categorii: string[]; gestiuni: string[] }>('/nomenclator/filtre'),
    staleTime: 10 * 60_000,
  })

  // Choosing another model invalidates the dimension and every material picked.
  useEffect(() => {
    setDimensiuneId('')
    setAlegeri({})
    setCantitatiLinii({})
    setLiniiExcluse([])
    setSuplimentare([])
  }, [modelId])

  const dimensiune = context.data?.dimensiuni.find((d) => d.id === dimensiuneId)
  const liniiVariabile = context.data?.liniiVariabile ?? []
  const toateAlese =
    liniiVariabile
      .filter((l) => !liniiExcluse.includes(l.id))
      .every((l) => alegeri[l.id] !== undefined) &&
    suplimentare.every((s) => s.articol !== null && normalizeazaZecimala(s.cantitate) !== null)
  // The fabric gets its own screen: it is the choice made on every bon, while
  // the rest of the variable lines are the rare exception.
  const stofe = liniiVariabile.filter((l) => l.categorieVariabila === 'TEXTIL')
  const alteVariabile = liniiVariabile.filter((l) => l.categorieVariabila !== 'TEXTIL')

  const alege = (linieId: string, articol: ArticolGasit) =>
    setAlegeri((curente) => ({ ...curente, [linieId]: articol }))
  const sterge = (linieId: string) =>
    setAlegeri((curente) =>
      Object.fromEntries(Object.entries(curente).filter(([cheie]) => cheie !== linieId)),
    )
  const scrieCantitate = (linieId: string, valoare: string) =>
    setCantitatiLinii((curente) => ({ ...curente, [linieId]: valoare }))
  const resetCantitate = (linieId: string) =>
    setCantitatiLinii((curente) =>
      Object.fromEntries(Object.entries(curente).filter(([cheie]) => cheie !== linieId)),
    )

  const cantitatiInvalide = Object.entries(cantitatiLinii).filter(
    ([, v]) => normalizeazaZecimala(v) === null,
  )

  const exclude = (linieId: string) => {
    setLiniiExcluse((curente) => [...new Set([...curente, linieId])])
    // The article it was given no longer means anything, and leaving it behind
    // would send it back to the API the moment the line is restored.
    sterge(linieId)
    resetCantitate(linieId)
  }
  const include = (linieId: string) =>
    setLiniiExcluse((curente) => curente.filter((id) => id !== linieId))

  const adaugaSuplimentar = () =>
    setSuplimentare((curente) => [
      ...curente,
      { cheie: crypto.randomUUID(), articol: null, cantitate: '' },
    ])
  const schimbaSuplimentar = (cheie: string, modificare: Partial<StofaSuplimentara>) =>
    setSuplimentare((curente) =>
      curente.map((s) => (s.cheie === cheie ? { ...s, ...modificare } : s)),
    )
  const stergeSuplimentar = (cheie: string) =>
    setSuplimentare((curente) => curente.filter((s) => s.cheie !== cheie))

  const cantitateCurata = normalizeazaZecimala(cantitate)
  const cantitateInvalida = cantitate.trim() !== '' && cantitateCurata === null

  const corp = () => ({
    modelId,
    dimensiuneId,
    cantitate: cantitateCurata ?? '',
    alegeri: Object.fromEntries(Object.entries(alegeri).map(([k, a]) => [k, a.codSaga])),
    cantitati: Object.fromEntries(
      Object.entries(cantitatiLinii).flatMap(([k, v]) => {
        const curat = normalizeazaZecimala(v)
        return curat === null ? [] : [[k, curat] as const]
      }),
    ),
    liniiExcluse,
    liniiSuplimentare: suplimentare.flatMap((s) => {
      const curat = normalizeazaZecimala(s.cantitate)
      return s.articol === null || curat === null
        ? []
        : [{ codSaga: s.articol.codSaga, cantitate: curat }]
    }),
  })

  const previzualizare = useMutation({
    mutationFn: () => apel<{ linii: Consum[] }>('/bonuri/previzualizare', { metoda: 'POST', corp: corp() }),
  })

  const salveaza = useMutation({
    mutationFn: () =>
      apel('/bonuri', {
        metoda: 'POST',
        corp: {
          ...corp(),
          data,
          nrDoc: nrDoc === '' ? null : nrDoc,
          gestiuneProdus,
        },
      }),
    onSuccess: async () => {
      localStorage.setItem('samobi:gestiune-produs', gestiuneProdus)
      // Kept on screen rather than wiped: „ce am băgat adineauri?" is the first
      // question after every save, and the answer used to vanish with the click.
      setSalvat({ cantitate: cantitateCurata ?? '', linii: previzualizare.data?.linii ?? [] })
      previzualizare.reset()
      notificari.succes('Bonul a fost salvat. Îl găsești mai jos, gata de export.')
      await queryClient.invalidateQueries({ queryKey: ['bonuri'] })
      refCantitate.current?.select()
    },
    onError: (e) => notificari.eroare(mesajEroare(e)),
  })

  const gata =
    modelId !== '' &&
    dimensiuneId !== '' &&
    toateAlese &&
    cantitateCurata !== null &&
    cantitatiInvalide.length === 0 &&
    dimensiune?.codSagaProdus != null

  /**
   * Anything that changes the numbers invalidates the preview.
   *
   * Without this the table on screen could show the consumption for one unit
   * while the save sent ten — the user was confirming figures that were not the
   * ones being written.
   */
  const reset = previzualizare.reset
  useEffect(() => {
    reset()
    setSalvat(null)
  }, [reset, cantitate, dimensiuneId, alegeri, cantitatiLinii, liniiExcluse, suplimentare])

  function trimite(eveniment: FormEvent) {
    eveniment.preventDefault()
    if (!gata) return
    if (previzualizare.isSuccess) salveaza.mutate()
    else previzualizare.mutate()
  }

  const liniiAfisate = previzualizare.data?.linii ?? salvat?.linii ?? []
  const modelAles = modele.data?.find((m) => m.id === modelId)

  return (
    <form onSubmit={trimite} className="card space-y-5 p-5">
      <div>
        <h2 className="text-lg font-semibold text-ink">Bon de predare nou</h2>
        <p className="mt-0.5 text-sm text-ink-muted">
          Enter previzualizează consumurile; încă un Enter salvează bonul.
        </p>
      </div>

      {modele.isError && <BannerEroare eroare={modele.error} onReincearca={() => void modele.refetch()} />}

      <div className="flex flex-wrap items-start gap-3">
        <div>
          <label htmlFor="model" className="eticheta">
            Model
          </label>
          <select
            id="model"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="camp w-64"
          >
            <option value="">{modele.isLoading ? 'se încarcă…' : 'alege…'}</option>
            {modele.data?.map((m) => (
              <option key={m.id} value={m.id} disabled={m.nrDimensiuni === 0}>
                {m.denumire} {m.nrDimensiuni === 0 ? '(fără dimensiuni)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="dimensiune" className="eticheta">
            Dimensiune
          </label>
          <select
            id="dimensiune"
            value={dimensiuneId}
            disabled={modelId === ''}
            onChange={(e) => setDimensiuneId(e.target.value)}
            className="camp w-44"
          >
            <option value="">{context.isFetching ? 'se încarcă…' : 'alege…'}</option>
            {context.data?.dimensiuni.map((d) => (
              <option key={d.id} value={d.id}>
                {d.cod}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="cantitate" className="eticheta">
            Cantitate
          </label>
          {/*
            Deliberately not `type="number"`: a scroll wheel over a focused
            number input silently changes the value, and this one ends up in
            SAGA. Decimals are normalised in code instead.
          */}
          <input
            id="cantitate"
            ref={refCantitate}
            value={cantitate}
            inputMode="decimal"
            aria-invalid={cantitateInvalida}
            onChange={(e) => setCantitate(e.target.value)}
            className="camp w-24 text-right tabular-nums"
          />
          {cantitateInvalida && <p className="indiciu text-danger">Ex.: 1 sau 1,5</p>}
        </div>

        <div>
          <label htmlFor="data" className="eticheta">
            Data
          </label>
          <input
            id="data"
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="camp"
          />
        </div>

        <div>
          <label htmlFor="nrdoc" className="eticheta">
            Nr. document
          </label>
          <input
            id="nrdoc"
            value={nrDoc}
            onChange={(e) => setNrDoc(e.target.value)}
            placeholder="opțional"
            className="camp w-32"
          />
        </div>

        <div>
          <label htmlFor="gestiune" className="eticheta">
            Gestiune produs
          </label>
          <input
            id="gestiune"
            list="gestiuni"
            value={gestiuneProdus}
            onChange={(e) => setGestiuneProdus(e.target.value)}
            className="camp w-48"
          />
          <datalist id="gestiuni">
            {(gestiuni.data?.gestiuni ?? [GESTIUNE_IMPLICITA]).map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </div>
      </div>

      {dimensiune !== undefined && dimensiune.codSagaProdus === null && (
        <p className="rounded-lg border border-atentie-border bg-atentie-bg px-3 py-2 text-sm text-atentie">
          Dimensiunea {dimensiune.cod} nu are cod de produs finit în SAGA. Leagă-l la „Modele și
          rețete" înainte de a emite bonul.
        </p>
      )}

      {stofe.length > 0 && (
        <AlegeStofe
          linii={stofe}
          alese={alegeri}
          bucati={Number(cantitateCurata ?? '1')}
          cantitati={cantitatiLinii}
          onAlege={alege}
          onCantitate={scrieCantitate}
          onResetCantitate={resetCantitate}
          excluse={liniiExcluse}
          onExclude={exclude}
          onInclude={include}
          suplimentare={suplimentare}
          onAdaugaSuplimentar={adaugaSuplimentar}
          onSchimbaSuplimentar={schimbaSuplimentar}
          onStergeSuplimentar={stergeSuplimentar}
          onAlegeToate={(articol) =>
            setAlegeri((curente) => ({
              ...curente,
              ...Object.fromEntries(
                stofe.filter((l) => !liniiExcluse.includes(l.id)).map((l) => [l.id, articol]),
              ),
            }))
          }
          onSterge={sterge}
        />
      )}

      {alteVariabile.length > 0 && (
        <div className="rounded-lg border border-info-border bg-info-bg p-4">
          <h3 className="text-sm font-semibold text-info">
            Materiale de ales ({alteVariabile.filter((l) => alegeri[l.id] !== undefined).length}/
            {alteVariabile.length})
          </h3>
          <p className="mt-1 text-sm text-ink-secondary">
            Rețeta dă cantitatea; codul concret se alege acum.
          </p>
          <ul className="mt-3 space-y-2">
            {alteVariabile.map((linie) => {
              const ales = alegeri[linie.id]
              return (
                <li key={linie.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-52 shrink-0 text-ink-secondary">
                    linia {linie.nrLinie} · {linie.grup} · {linie.um}
                  </span>
                  {ales === undefined ? (
                    <CautaArticol
                      umAsteptat={linie.um}
                      onAlege={(a) => alege(linie.id, a)}
                      placeholder={
                        linie.categorieVariabila === null
                          ? 'caută material…'
                          : `caută în ${linie.categorieVariabila}…`
                      }
                    />
                  ) : (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-surface px-2 py-1 font-mono text-xs">
                        {ales.codSaga}
                      </span>
                      <span className="text-ink">{ales.denumire}</span>
                      <span className="text-xs text-ink-muted">({ales.um})</span>
                      <button
                        type="button"
                        onClick={() => sterge(linie.id)}
                        className="text-xs text-brand underline underline-offset-2"
                      >
                        schimbă
                      </button>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={!gata || previzualizare.isPending || salveaza.isPending}
          className={previzualizare.isSuccess ? 'buton buton-primar' : 'buton buton-secundar'}
        >
          {previzualizare.isPending
            ? 'Se calculează…'
            : salveaza.isPending
              ? 'Se salvează…'
              : previzualizare.isSuccess
                ? 'Salvează bonul'
                : 'Previzualizează consumurile'}
        </button>
        {previzualizare.isSuccess && (
          <button
            type="button"
            onClick={() => previzualizare.mutate()}
            className="buton buton-discret buton-mic"
          >
            Recalculează
          </button>
        )}
      </div>

      {previzualizare.isError && (
        <BannerEroare eroare={previzualizare.error} titlu="Calculul a eșuat." />
      )}

      {liniiAfisate.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-ink-secondary">
            {salvat !== null ? 'Consumuri salvate' : 'Consumuri'} pentru{' '}
            <strong className="text-ink">
              {cant(salvat?.cantitate ?? cantitateCurata)} buc · {modelAles?.denumire}{' '}
              {dimensiune?.cod}
            </strong>
          </p>
          <TabelConsumuri linii={liniiAfisate} />
        </div>
      )}
    </form>
  )
}

function TabelConsumuri({ linii }: { linii: Consum[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-sm" aria-label="Consumuri de material">
        <thead className="bg-surface-sunken text-left text-xs uppercase text-ink-muted">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">
              Cod
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Denumire
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              UM
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Net
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Brut
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              În fișier
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Sursă
            </th>
          </tr>
        </thead>
        <tbody>
          {linii.map((linie) => (
            <tr key={linie.codSaga} className="border-t border-line hover:bg-surface-page">
              <td className="px-4 py-2 font-mono text-xs">{linie.codSaga}</td>
              <td className="px-4 py-2">{linie.denumire}</td>
              <td className="px-4 py-2 text-ink-muted">{linie.um}</td>
              <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                {cant(linie.cantitateNeta)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                {cant(linie.cantitateBruta)}
              </td>
              <td className="px-4 py-2 text-right font-medium tabular-nums">
                {cant(linie.cantitateBrutaRotunjita)}
              </td>
              <td className="px-4 py-2 text-xs">
                {linie.sursa === 'override' || linie.sursa === 'manual' ? (
                  <Insigna fel="atentie">{ETICHETE_SURSA[linie.sursa]}</Insigna>
                ) : (
                  <span className="text-ink-muted">{ETICHETE_SURSA[linie.sursa] ?? linie.sursa}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type Filtru = 'de-exportat' | 'exportat' | 'anulat' | 'toate'

const FILTRE: { cheie: Filtru; eticheta: string; status?: string }[] = [
  { cheie: 'de-exportat', eticheta: 'De exportat', status: 'calculat' },
  { cheie: 'exportat', eticheta: 'Exportate', status: 'exportat' },
  { cheie: 'anulat', eticheta: 'Anulate', status: 'anulat' },
  { cheie: 'toate', eticheta: 'Toate' },
]

function ListaBonuri() {
  const queryClient = useQueryClient()
  const notificari = useNotificari()
  const [filtru, setFiltru] = useState<Filtru>('de-exportat')
  const [selectate, setSelectate] = useState<string[]>([])
  const [desfasurat, setDesfasurat] = useState<string | null>(null)
  const [ultimulExport, setUltimulExport] = useState<{
    id: string
    nrBonuri: number
    nrLinii: number
  } | null>(null)

  const status = FILTRE.find((f) => f.cheie === filtru)?.status

  const bonuri = useQuery({
    queryKey: ['bonuri', status ?? 'toate'],
    queryFn: () => apel<RandBon[]>(`/bonuri${status === undefined ? '' : `?status=${status}`}`),
  })

  /** The signed link, fetched apart from the export so a failed download is not a failed export. */
  async function descarca(id: string) {
    const { url } = await apel<{ url: string }>(`/export/${id}/descarcare`)
    const legatura = document.createElement('a')
    legatura.href = url
    legatura.download = ''
    document.body.append(legatura)
    legatura.click()
    legatura.remove()
  }

  const exporta = useMutation({
    mutationFn: (confirmaReexport: boolean) =>
      apel<{ id: string; nrLinii: number; nrBonuri: number }>('/export', {
        metoda: 'POST',
        corp: { bonIds: selectate, confirmaReexport },
      }),
    onSuccess: async (lot) => {
      setSelectate([])
      setUltimulExport(lot)
      await queryClient.invalidateQueries({ queryKey: ['bonuri'] })
      try {
        await descarca(lot.id)
      } catch (e) {
        // The export exists on the server either way; only the file is missing,
        // and re-exporting to get it would double-book the consumption.
        notificari.eroare(
          `Exportul s-a generat, dar fișierul nu s-a descărcat. ${mesajEroare(e)} Folosește „Descarcă din nou".`,
        )
      }
    },
    onError: (e) => {
      if (!(e instanceof EroareApi && e.status === 409)) notificari.eroare(mesajEroare(e))
    },
  })

  const anuleaza = useMutation({
    mutationFn: (id: string) => apel(`/bonuri/${id}/anulare`, { metoda: 'POST' }),
    onSuccess: async () => {
      notificari.succes('Bonul a fost anulat.')
      await queryClient.invalidateQueries({ queryKey: ['bonuri'] })
    },
    onError: (e) => notificari.eroare(mesajEroare(e)),
  })

  function comuta(id: string) {
    // A „yes, send them again" ticked for one selection must not authorise the
    // next one; the reset lives here because this is where the selection changes.
    exporta.reset()
    setSelectate((curente) =>
      curente.includes(id) ? curente.filter((x) => x !== id) : [...curente, id],
    )
  }

  const randuri = bonuri.data ?? []
  const selectabile = randuri.filter((b) => b.status === 'calculat' || filtru === 'exportat')
  const toateSelectate = selectabile.length > 0 && selectate.length === selectabile.length

  const conflict = exporta.error instanceof EroareApi && exporta.error.status === 409
  const nrColoane = 8

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Bonuri</h2>
        <button
          type="button"
          disabled={selectate.length === 0 || exporta.isPending}
          onClick={() => exporta.mutate(false)}
          className="buton buton-primar"
        >
          {exporta.isPending
            ? 'Se generează…'
            : `Exportă ${selectate.length} bon${selectate.length === 1 ? '' : 'uri'}`}
        </button>
      </div>

      <div className="inline-flex rounded-lg bg-surface-sunken p-1">
        {FILTRE.map((f) => (
          <button
            key={f.cheie}
            type="button"
            onClick={() => {
              setFiltru(f.cheie)
              setSelectate([])
              exporta.reset()
            }}
            className={
              filtru === f.cheie
                ? 'rounded-md bg-surface px-3 py-1.5 text-sm font-medium text-ink shadow-[0_1px_2px_rgb(28_25_23/0.06)]'
                : 'rounded-md px-3 py-1.5 text-sm text-ink-muted hover:text-ink'
            }
          >
            {f.eticheta}
          </button>
        ))}
      </div>

      {ultimulExport !== null && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-succes-border bg-succes-bg px-4 py-3 text-sm">
          <p className="flex-1 text-succes">
            Export generat: {ultimulExport.nrBonuri} bonuri, {ultimulExport.nrLinii} linii de
            material.
          </p>
          <button
            type="button"
            onClick={() => {
              void descarca(ultimulExport.id).catch((e: unknown) =>
                notificari.eroare(mesajEroare(e)),
              )
            }}
            className="buton buton-secundar buton-mic"
          >
            Descarcă din nou
          </button>
          <button
            type="button"
            onClick={() => setUltimulExport(null)}
            className="buton buton-discret buton-mic"
          >
            Închide
          </button>
        </div>
      )}

      {conflict && (
        <div className="rounded-lg border border-atentie-border bg-atentie-bg px-4 py-3 text-sm">
          <p className="text-atentie">{(exporta.error as EroareApi).message}</p>
          <p className="mt-1 text-ink-secondary">
            Retrimiterea în SAGA înseamnă că materialul se scade a doua oară.
          </p>
          <button
            type="button"
            disabled={exporta.isPending}
            onClick={() => exporta.mutate(true)}
            className="buton buton-pericol buton-mic mt-2"
          >
            Reexportă oricum cele {selectate.length} bonuri
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm" aria-label="Bonuri de producție">
          <thead className="bg-surface-sunken text-left text-xs uppercase text-ink-muted">
            <tr>
              <th scope="col" className="w-10 px-3 py-2">
                {selectabile.length > 0 && (
                  <input
                    type="checkbox"
                    checked={toateSelectate}
                    aria-label="Selectează toate bonurile de exportat"
                    onChange={() => {
                      exporta.reset()
                      setSelectate(toateSelectate ? [] : selectabile.map((b) => b.id))
                    }}
                  />
                )}
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Data
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Nr. doc
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Produs
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Dimensiune
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Cantitate
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Stare
              </th>
              <th scope="col" className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {bonuri.isLoading && <RanduriSchelet coloane={nrColoane} />}

            {bonuri.isError && (
              <RandStare coloane={nrColoane}>
                <BannerEroare
                  eroare={bonuri.error}
                  titlu="Bonurile nu s-au putut încărca."
                  onReincearca={() => void bonuri.refetch()}
                />
              </RandStare>
            )}

            {!bonuri.isLoading && !bonuri.isError && randuri.length === 0 && (
              <RandStare coloane={nrColoane}>
                <Gol
                  titlu={filtru === 'de-exportat' ? 'Nimic de exportat' : 'Niciun bon aici'}
                  indiciu={
                    filtru === 'de-exportat'
                      ? 'Bonurile salvate apar aici până pleacă în SAGA.'
                      : undefined
                  }
                />
              </RandStare>
            )}

            {randuri.map((bon) => {
              const stare = ETICHETE_STATUS[bon.status] ?? { text: bon.status, fel: 'neutru' as const }
              const bifabil = bon.status === 'calculat' || filtru === 'exportat'
              return (
                <RandBonuri
                  key={bon.id}
                  bon={bon}
                  stare={stare}
                  bifabil={bifabil}
                  bifat={selectate.includes(bon.id)}
                  onComuta={() => comuta(bon.id)}
                  desfasurat={desfasurat === bon.id}
                  onDesfasoara={() => setDesfasurat((d) => (d === bon.id ? null : bon.id))}
                  poateAnula={bon.status !== 'exportat' && bon.status !== 'anulat'}
                  onAnuleaza={() => anuleaza.mutate(bon.id)}
                  coloane={nrColoane}
                />
              )
            })}
          </tbody>
        </table>
      </div>

      {randuri.length === 200 && (
        <p className="text-xs text-ink-muted">
          Se afișează ultimele 200 de bonuri. Filtrează ca să vezi restul.
        </p>
      )}
    </div>
  )
}

function RandBonuri({
  bon,
  stare,
  bifabil,
  bifat,
  onComuta,
  desfasurat,
  onDesfasoara,
  poateAnula,
  onAnuleaza,
  coloane,
}: {
  bon: RandBon
  stare: { text: string; fel: 'succes' | 'info' | 'neutru' }
  bifabil: boolean
  bifat: boolean
  onComuta: () => void
  desfasurat: boolean
  onDesfasoara: () => void
  poateAnula: boolean
  onAnuleaza: () => void
  coloane: number
}) {
  const detaliu = useQuery({
    queryKey: ['bon', bon.id],
    queryFn: () => apel<{ linii: LinieBon[] }>(`/bonuri/${bon.id}`),
    enabled: desfasurat,
  })

  return (
    <>
      <tr
        className={`border-t border-line ${bon.status === 'anulat' ? 'text-ink-muted' : ''} hover:bg-surface-page`}
      >
        <td className="px-3 py-2">
          {bifabil && (
            <input
              type="checkbox"
              checked={bifat}
              onChange={onComuta}
              aria-label={`Selectează bonul din ${dataRo(bon.data)}`}
            />
          )}
        </td>
        <td className="px-4 py-2 whitespace-nowrap text-ink-secondary">{dataRo(bon.data)}</td>
        <td className="px-4 py-2 text-ink-muted">{bon.nrDoc ?? '—'}</td>
        <td className="px-4 py-2">
          <button type="button" onClick={onDesfasoara} className="text-left hover:underline">
            {bon.modelDenumire}
            <span className="ml-2 font-mono text-xs text-ink-muted">{bon.codSagaProdus}</span>
          </button>
        </td>
        <td className="px-4 py-2 text-ink-secondary">{bon.dimensiuneCod}</td>
        <td className="px-4 py-2 text-right tabular-nums">{cant(bon.cantitate)}</td>
        <td className="px-4 py-2">
          <Insigna fel={stare.fel}>{stare.text}</Insigna>
        </td>
        <td className="px-4 py-2 text-right">
          {poateAnula && (
            <Confirma
              eticheta="Anulează"
              intrebare={`Anulezi bonul din ${dataRo(bon.data)}, ${bon.modelDenumire} × ${cant(bon.cantitate)}?`}
              confirmare="Da, anulează"
              onConfirma={onAnuleaza}
            />
          )}
        </td>
      </tr>

      {desfasurat && (
        <tr className="border-t border-line bg-surface-page">
          <td colSpan={coloane} className="px-4 py-3">
            {detaliu.isLoading && <p className="text-sm text-ink-muted">Se încarcă liniile…</p>}
            {detaliu.isError && <BannerEroare eroare={detaliu.error} />}
            {detaliu.data !== undefined && (
              <table className="w-full text-sm" aria-label="Liniile bonului">
                <thead className="text-left text-xs uppercase text-ink-muted">
                  <tr>
                    <th scope="col" className="py-1 font-medium">
                      Cod
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      Denumire
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      UM
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      Net
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      Brut
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      Sursă
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detaliu.data.linii.map((l) => (
                    <tr key={l.codSaga} className="border-t border-line">
                      <td className="py-1 font-mono text-xs">{l.codSaga}</td>
                      <td className="py-1">{l.denumire ?? '—'}</td>
                      <td className="py-1 text-ink-muted">{l.um}</td>
                      <td className="py-1 text-right tabular-nums text-ink-muted">
                        {cant(l.cantitateNeta)}
                      </td>
                      <td className="py-1 text-right tabular-nums">{cant(l.cantitateBruta)}</td>
                      <td className="py-1 text-xs text-ink-muted">
                        {ETICHETE_SURSA[l.sursa] ?? l.sursa}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
