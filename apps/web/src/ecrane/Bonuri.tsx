import type { UtilizatorCurent } from '@samobi/shared/scheme'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { apel, EroareApi } from '../lib/api.js'
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

/** The envelope the model may be built in, when it is sold made to order. */
interface LaComanda {
  lungimeMin: string
  lungimeMax: string
  latimeMin: string
  latimeMax: string
  inaltimeMin: string | null
  inaltimeMax: string | null
  codSagaProdus: string | null
  denumireProdus: string | null
}

interface LinieTabel {
  id: string
  nrLinie: number
  grup: string
  um: string
  valori: { dimensiuneId: string; cantitate: string }[]
}

interface Context {
  dimensiuni: Dimensiune[]
  laComanda: LaComanda | null
  liniiVariabile: LinieVariabila[]
  liniiTabel: LinieTabel[]
}

/** The value chosen in the dimension select when the size is made to order. */
const LA_COMANDA = 'la-comanda'

interface LinieVariabila {
  id: string
  nrLinie: number
  grup: string
  um: string
  categorieVariabila: string | null
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
  dimensiuneCod: string | null
  lungime: string
  latime: string
  inaltime: string | null
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
}

const GESTIUNE_IMPLICITA = 'MATERII PRIME'

export function Bonuri({ utilizator }: { utilizator: UtilizatorCurent }) {
  const poateEmite = utilizator.rol !== 'contabil'
  const poateExporta = utilizator.rol !== 'tehnolog'

  return (
    <section className="space-y-8">
      {poateEmite && <BonNou />}
      <ListaBonuri poateExporta={poateExporta} poateAnula={poateEmite} />
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
  const [salvat, setSalvat] = useState<{ cantitate: string; linii: Consum[] } | null>(null)
  const refCantitate = useRef<HTMLInputElement>(null)
  const refLungime = useRef<HTMLInputElement>(null)

  // Made-to-order state. Kept apart from `dimensiuneId` on purpose: the two are
  // alternatives, and mixing them is how a form ends up sending both.
  const [lungime, setLungime] = useState('')
  const [latime, setLatime] = useState('')
  const [inaltime, setInaltime] = useState('')
  const [valoriManuale, setValoriManuale] = useState<Record<string, string>>({})

  const modele = useQuery({
    queryKey: ['modele'],
    queryFn: () => apel<RandModel[]>('/modele'),
  })

  // The variable and table lines come from the recipe, not from the size, so any
  // registered dimension will do to load them — including for a made-to-order
  // bon, which has no dimension of its own.
  const dimensiunePentruContext =
    dimensiuneId === LA_COMANDA ? '' : dimensiuneId

  const context = useQuery({
    queryKey: ['bon-context', modelId, dimensiunePentruContext],
    queryFn: () =>
      apel<Context>(
        `/bonuri/context/${modelId}${
          dimensiunePentruContext === '' ? '' : `?dimensiuneId=${dimensiunePentruContext}`
        }`,
      ),
    enabled: modelId !== '',
  })

  const contextComanda = useQuery({
    queryKey: ['bon-context-comanda', modelId, context.data?.dimensiuni[0]?.id],
    queryFn: () =>
      apel<Context>(`/bonuri/context/${modelId}?dimensiuneId=${context.data?.dimensiuni[0]?.id ?? ''}`),
    enabled: dimensiuneId === LA_COMANDA && (context.data?.dimensiuni.length ?? 0) > 0,
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
    setValoriManuale({})
    setLungime('')
    setLatime('')
    setInaltime('')
  }, [modelId])

  const laComanda = dimensiuneId === LA_COMANDA
  const interval = context.data?.laComanda ?? null
  const dimensiune = context.data?.dimensiuni.find((d) => d.id === dimensiuneId)
  const sursaLinii = laComanda ? (contextComanda.data ?? null) : (context.data ?? null)
  const liniiVariabile = sursaLinii?.liniiVariabile ?? []
  const liniiTabel = laComanda ? (sursaLinii?.liniiTabel ?? []) : []
  const toateAlese = liniiVariabile.every((l) => alegeri[l.id] !== undefined)

  const inAfara = (valoare: string, min: string | null, max: string | null): boolean => {
    if (valoare === '' || min === null || max === null) return false
    const n = Number(valoare)
    return !Number.isFinite(n) || n < Number(min) || n > Number(max)
  }

  const masuriValide =
    !laComanda ||
    (interval !== null &&
      /^[1-9]\d{0,4}$/.test(lungime) &&
      /^[1-9]\d{0,4}$/.test(latime) &&
      (inaltime === '' || /^[1-9]\d{0,4}$/.test(inaltime)) &&
      !inAfara(lungime, interval.lungimeMin, interval.lungimeMax) &&
      !inAfara(latime, interval.latimeMin, interval.latimeMax) &&
      !inAfara(inaltime, interval.inaltimeMin, interval.inaltimeMax))

  const manualeComplete =
    !laComanda || liniiTabel.every((l) => normalizeazaZecimala(valoriManuale[l.id] ?? '') !== null)

  /** The registered size the operator typed by hand, if they did. */
  const dimensiuneIdentica = laComanda
    ? context.data?.dimensiuni.find(
        (d) =>
          Number(d.lungime) === Number(lungime) &&
          Number(d.latime) === Number(latime) &&
          (inaltime === '' ? d.inaltime === null : Number(d.inaltime) === Number(inaltime)),
      )
    : undefined

  const cantitateCurata = normalizeazaZecimala(cantitate)
  const cantitateInvalida = cantitate.trim() !== '' && cantitateCurata === null

  const corp = () => ({
    modelId,
    ...(laComanda
      ? {
          dimensiune: { lungime, latime, inaltime: inaltime === '' ? null : inaltime },
          valoriManuale: Object.fromEntries(
            Object.entries(valoriManuale)
              .map(([k, v]) => [k, normalizeazaZecimala(v) ?? ''])
              .filter(([, v]) => v !== ''),
          ),
        }
      : { dimensiuneId }),
    cantitate: cantitateCurata ?? '',
    alegeri: Object.fromEntries(Object.entries(alegeri).map(([k, a]) => [k, a.codSaga])),
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

  const codPredare = laComanda ? (interval?.codSagaProdus ?? null) : (dimensiune?.codSagaProdus ?? null)

  const gata =
    modelId !== '' &&
    dimensiuneId !== '' &&
    toateAlese &&
    masuriValide &&
    manualeComplete &&
    cantitateCurata !== null &&
    codPredare !== null

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
  }, [reset, cantitate, dimensiuneId, alegeri, lungime, latime, inaltime, valoriManuale])

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
            {/* The entire cost of this feature to the common path: one line in a
                dropdown nobody scrolls past their target. */}
            {interval !== null && <option value={LA_COMANDA}>Altă dimensiune…</option>}
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

      {laComanda && interval !== null && (
        <div className="rounded-lg border border-line bg-surface-page p-4">
          <h3 className="text-sm font-semibold text-ink">Dimensiune la comandă (mm)</h3>

          <div className="mt-3 flex flex-wrap gap-4">
            <MasuraLaComanda
              eticheta="Lungime"
              valoare={lungime}
              onSchimba={setLungime}
              min={interval.lungimeMin}
              max={interval.lungimeMax}
              refInput={refLungime}
            />
            <MasuraLaComanda
              eticheta="Lățime"
              valoare={latime}
              onSchimba={setLatime}
              min={interval.latimeMin}
              max={interval.latimeMax}
            />
            {interval.inaltimeMin !== null && interval.inaltimeMax !== null && (
              <MasuraLaComanda
                eticheta="Înălțime"
                valoare={inaltime}
                onSchimba={setInaltime}
                min={interval.inaltimeMin}
                max={interval.inaltimeMax}
              />
            )}
          </div>

          {dimensiuneIdentica !== undefined && (
            <p className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-info-border bg-info-bg px-3 py-2 text-sm text-info">
              Exact dimensiunea înregistrată {dimensiuneIdentica.cod}. Folosește-o — bonul se predă
              pe codul ei de produs.
              <button
                type="button"
                onClick={() => setDimensiuneId(dimensiuneIdentica.id)}
                className="buton buton-secundar buton-mic"
              >
                Treci pe {dimensiuneIdentica.cod}
              </button>
            </p>
          )}

          <p className="mt-3 text-sm">
            {interval.codSagaProdus === null ? (
              <span className="text-atentie">
                Modelul acceptă dimensiuni la comandă, dar nu are cod de predare pentru ele.
                Tehnologul îl leagă la „Modele și rețete".
              </span>
            ) : (
              <>
                <span className="text-ink-secondary">Se predă pe: </span>
                <span className="font-mono text-xs">{interval.codSagaProdus}</span>{' '}
                <span className="text-ink">{interval.denumireProdus}</span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  În SAGA apare acest cod; dimensiunea rămâne pe bon, aici în aplicație.
                </span>
              </>
            )}
          </p>
        </div>
      )}

      {laComanda && liniiTabel.length > 0 && (
        <div className="rounded-lg border border-atentie-border bg-atentie-bg p-4">
          <h3 className="text-sm font-semibold text-atentie">
            Cantități de completat (
            {liniiTabel.filter((l) => normalizeazaZecimala(valoriManuale[l.id] ?? '') !== null).length}
            /{liniiTabel.length})
          </h3>
          <p className="mt-1 text-sm text-ink-secondary">
            Liniile «tabel» nu au valori pentru dimensiunea asta. Rețeta nu le poate calcula —
            metrajul depinde de croială, nu de geometrie. Dacă nu-l știi, cere-l tehnologului.
          </p>
          <ul className="mt-3 space-y-2">
            {liniiTabel.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-52 shrink-0 text-ink-secondary">
                  linia {l.nrLinie} · {l.grup} · {l.um}
                </span>
                <input
                  value={valoriManuale[l.id] ?? ''}
                  inputMode="decimal"
                  aria-label={`Cantitate pentru linia ${l.nrLinie}`}
                  aria-invalid={
                    (valoriManuale[l.id] ?? '') !== '' &&
                    normalizeazaZecimala(valoriManuale[l.id] ?? '') === null
                  }
                  onChange={(e) =>
                    setValoriManuale((curente) => ({ ...curente, [l.id]: e.target.value }))
                  }
                  className="camp camp-mic w-24 text-right tabular-nums"
                />
                {l.valori.length > 0 && (
                  <span className="text-xs text-ink-muted">
                    {l.valori
                      .map((v) => {
                        const dim = context.data?.dimensiuni.find((d) => d.id === v.dimensiuneId)
                        return dim === undefined ? null : `la ${dim.cod}: ${cant(v.cantitate)}`
                      })
                      .filter((x) => x !== null)
                      .join(' · ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {dimensiune !== undefined && dimensiune.codSagaProdus === null && (
        <p className="rounded-lg border border-atentie-border bg-atentie-bg px-3 py-2 text-sm text-atentie">
          Dimensiunea {dimensiune.cod} nu are cod de produs finit în SAGA. Leagă-l la „Modele și
          rețete" înainte de a emite bonul.
        </p>
      )}

      {liniiVariabile.length > 0 && (
        <div className="rounded-lg border border-info-border bg-info-bg p-4">
          <h3 className="text-sm font-semibold text-info">
            Materiale de ales ({liniiVariabile.filter((l) => alegeri[l.id] !== undefined).length}/
            {liniiVariabile.length})
          </h3>
          <p className="mt-1 text-sm text-ink-secondary">
            Rețeta dă metrajul; codul concret se alege acum. Același model în altă stofă folosește
            aceeași rețetă.
          </p>
          <ul className="mt-3 space-y-2">
            {liniiVariabile.map((linie) => {
              const ales = alegeri[linie.id]
              return (
                <li key={linie.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-52 shrink-0 text-ink-secondary">
                    linia {linie.nrLinie} · {linie.grup} · {linie.um}
                  </span>
                  {ales === undefined ? (
                    <CautaArticol
                      umAsteptat={linie.um}
                      onAlege={(a) => setAlegeri((curente) => ({ ...curente, [linie.id]: a }))}
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
                        onClick={() =>
                          setAlegeri((curente) =>
                            Object.fromEntries(
                              Object.entries(curente).filter(([cheie]) => cheie !== linie.id),
                            ),
                          )
                        }
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
              {laComanda
                ? `${lungime}×${latime}${inaltime === '' ? '' : `×${inaltime}`}`
                : dimensiune?.cod}
            </strong>
            {laComanda && <Insigna fel="info">la comandă</Insigna>}
          </p>
          <TabelConsumuri linii={liniiAfisate} />
        </div>
      )}
    </form>
  )
}

/**
 * One made-to-order measurement.
 *
 * Whole millimetres only. Furniture is not cut at half a millimetre, and
 * refusing the decimal removes the question of whether the comma meant a
 * decimal point or a thumb on the wrong key.
 */
function MasuraLaComanda({
  eticheta,
  valoare,
  onSchimba,
  min,
  max,
  refInput,
}: {
  eticheta: string
  valoare: string
  onSchimba: (v: string) => void
  min: string
  max: string
  refInput?: React.RefObject<HTMLInputElement | null>
}) {
  const intreg = /^[1-9]\d{0,4}$/.test(valoare)
  const n = Number(valoare)
  const subMinim = intreg && n < Number(min)
  const pesteMaxim = intreg && n > Number(max)
  const gresit = valoare !== '' && (!intreg || subMinim || pesteMaxim)

  return (
    <div>
      <label className="eticheta">{eticheta}</label>
      <input
        ref={refInput}
        value={valoare}
        inputMode="numeric"
        aria-invalid={gresit}
        onChange={(e) => onSchimba(e.target.value)}
        className="camp w-28 text-right tabular-nums"
      />
      <p className={`indiciu ${gresit ? 'text-danger' : ''}`}>
        {!intreg && valoare !== ''
          ? 'milimetri întregi, ex. 2150'
          : subMinim
            ? `sub minimul de ${Number(min)}`
            : pesteMaxim
              ? `peste maximul de ${Number(max)}`
              : `${Number(min)}–${Number(max)}`}
      </p>
    </div>
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
                {linie.sursa === 'override' ? (
                  <Insigna fel="atentie">fixată manual</Insigna>
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

function ListaBonuri({
  poateExporta,
  poateAnula,
}: {
  poateExporta: boolean
  poateAnula: boolean
}) {
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
        {poateExporta && (
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
        )}
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
                {poateExporta && selectabile.length > 0 && (
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
              const bifabil = poateExporta && (bon.status === 'calculat' || filtru === 'exportat')
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
                  poateAnula={poateAnula && bon.status !== 'exportat' && bon.status !== 'anulat'}
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
        <td className="px-4 py-2 text-ink-secondary">
          {bon.dimensiuneCod ?? (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="tabular-nums">
                {Number(bon.lungime)}×{Number(bon.latime)}
                {bon.inaltime === null ? '' : `×${Number(bon.inaltime)}`}
              </span>
              <Insigna fel="info">la comandă</Insigna>
            </span>
          )}
        </td>
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
