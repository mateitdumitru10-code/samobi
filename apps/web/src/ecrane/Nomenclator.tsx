import type { UtilizatorCurent } from '@samobi/shared/scheme'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'

import { apel, incarcaFisier } from '../lib/api.js'
import { CautaArticol, UmPotrivit } from '../ui/CautaArticol.js'
import { useNotificari } from '../ui/Notificari.js'
import { cant, lei } from '../ui/numere.js'
import {
  BannerEroare,
  Gol,
  Insigna,
  RanduriSchelet,
  RandStare,
  mesajEroare,
} from '../ui/stari.js'

interface Articol {
  codSaga: string
  denumire: string
  um: string
  umNormalizat: string | null
  tip: string
  cont: string | null
  gestiuneImplicita: string | null
  categorie: string | null
  pretReferinta: string | null
  stoc: string | null
  activ: boolean
  sincronizatLa: string | null
}

interface Pagina {
  total: number
  pagina: number
  pePagina: number
  articole: Articol[]
}

interface Raport {
  fisier: string
  randuriInFisier: number
  articoleInFisier: number
  noi: number
  modificate: number
  neschimbate: number
  disparute: number
  exempleNoi: { codSaga: string; denumire: string }[]
  exempleModificate: { codSaga: string; denumire: string; schimbari: string[] }[]
  umNecunoscute: { um: string; articole: number }[]
}

interface Ocurenta {
  modelCod: string
  modelDenumire: string
  nrLinie: number
  um: string
  cantitate: string
  grup: string
}

interface Sugestie {
  codSaga: string
  denumire: string
  scor: number
  um: string
  tip: string | null
  pretReferinta: string | null
  pretConsum: string | null
  stoc: string | null
}

interface Nemapat {
  id: string
  denumireExterna: string
  amanat: boolean
  ocurente: Ocurenta[]
  sugestii: Sugestie[]
}

const ETICHETE_TIP: Record<string, string> = {
  produs: 'Produs finit',
  materie_prima: 'Materie primă',
  marfa: 'Marfă',
  altele: 'Altele',
}

const PE_PAGINA = 50

export function Nomenclator({ utilizator }: { utilizator: UtilizatorCurent }) {
  const poateImporta = utilizator.rol === 'admin' || utilizator.rol === 'tehnolog'

  return (
    <section className="space-y-8">
      {poateImporta && <PanouImport />}
      <CoadaMapare poateEdita={poateImporta} />
      <Catalog />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Coada de mapare
// ---------------------------------------------------------------------------

/**
 * The queue of material names with no article behind them.
 *
 * This is a hundred and seventy small decisions taken in one sitting, so what
 * matters is the cost of a single one. Everything a decision needs — the unit
 * the recipe writes, the unit the article is held in, whether it has a price
 * and stock — sits on the row, and the first three suggestions answer to the
 * keys 1, 2 and 3. Nothing asks „sigur?": every mapping can be undone from the
 * notification it raises, which is the version of safety that survives being
 * done a hundred times.
 */
function CoadaMapare({ poateEdita }: { poateEdita: boolean }) {
  const queryClient = useQueryClient()
  const notificari = useNotificari()
  const [rezolvateAcum, setRezolvateAcum] = useState(0)
  const [aratAmanate, setAratAmanate] = useState(false)

  const nemapate = useQuery({
    queryKey: ['nomenclator', 'nemapate'],
    queryFn: () => apel<Nemapat[]>('/nomenclator/nemapate'),
  })

  async function reincarca() {
    // The recipes changed too, not just the queue.
    await queryClient.invalidateQueries({ queryKey: ['nomenclator', 'nemapate'] })
    await queryClient.invalidateQueries({ queryKey: ['reteta'] })
    await queryClient.invalidateQueries({ queryKey: ['modele'] })
  }

  const anuleaza = useMutation({
    mutationFn: (id: string) =>
      apel<{ denumire: string; liniiSterse: number; liniiPastrate: number }>(
        `/nomenclator/nemapate/${id}/anulare`,
        { metoda: 'POST' },
      ),
    onSuccess: async (r) => {
      setRezolvateAcum((n) => Math.max(0, n - 1))
      notificari.succes(
        `„${r.denumire}" e din nou în coadă. ${r.liniiSterse} linii scoase din rețete` +
          (r.liniiPastrate > 0 ? `, ${r.liniiPastrate} păstrate (modificate între timp).` : '.'),
      )
      await reincarca()
    },
    onError: (e) => notificari.eroare(mesajEroare(e)),
  })

  const rezolva = useMutation({
    mutationFn: (v: { id: string; codSaga: string; denumire: string }) =>
      apel<{ denumire: string; linii: number; sarite: number }>(
        `/nomenclator/nemapate/${v.id}/rezolvare`,
        { metoda: 'POST', corp: { codSaga: v.codSaga } },
      ),
    onSuccess: async (r, v) => {
      setRezolvateAcum((n) => n + 1)
      notificari.succes(
        `„${r.denumire}" → ${v.denumire}. ${r.linii} linii adăugate` +
          (r.sarite > 0 ? `, ${r.sarite} sărite (rețetă activă).` : '.'),
        { eticheta: 'Anulează', executa: () => anuleaza.mutate(v.id) },
      )
      await reincarca()
    },
    onError: (e) => notificari.eroare(mesajEroare(e)),
  })

  const amana = useMutation({
    mutationFn: (v: { id: string; amanat: boolean }) =>
      apel(`/nomenclator/nemapate/${v.id}/amanare`, {
        metoda: 'POST',
        corp: { amanat: v.amanat },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nomenclator', 'nemapate'] }),
    onError: (e) => notificari.eroare(mesajEroare(e)),
  })

  const toate = nemapate.data ?? []
  // Best first: a run of easy ones builds rhythm, and the hard ones end up
  // grouped at the bottom instead of scattered through the alphabet.
  const active = useMemo(
    () =>
      toate
        .filter((n) => !n.amanat)
        .slice()
        .sort((a, b) => (b.sugestii[0]?.scor ?? 0) - (a.sugestii[0]?.scor ?? 0)),
    [toate],
  )
  const amanate = toate.filter((n) => n.amanat)

  if (nemapate.isLoading) {
    return (
      <div className="card space-y-3 p-5">
        <div className="h-4 w-64 animate-pulse rounded bg-surface-sunken" />
        <div className="h-20 w-full animate-pulse rounded bg-surface-sunken" />
      </div>
    )
  }

  if (nemapate.isError) {
    return (
      <BannerEroare
        eroare={nemapate.error}
        titlu="Coada de mapare nu s-a putut încărca."
        onReincearca={() => void nemapate.refetch()}
      />
    )
  }

  if (toate.length === 0) {
    return (
      <div className="card p-5">
        <p className="flex items-center gap-2 text-sm text-succes">
          <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
            <path
              d="M4 10.5l4 4 8-9"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Toate materialele din rețete au corespondent în SAGA.
        </p>
      </div>
    )
  }

  const liniiLipsa = active.reduce((s, n) => s + n.ocurente.length, 0)

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line bg-atentie-bg px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-atentie">
            Materiale fără corespondent ({active.length})
          </h2>
          <span className="text-sm text-ink-secondary">
            {rezolvateAcum > 0 && (
              <span className="mr-2 font-medium text-succes">{rezolvateAcum} rezolvate acum ·</span>
            )}
            {liniiLipsa} linii de rețetă lipsesc din cauza lor
          </span>
        </div>
        <p className="mt-1 text-sm text-ink-secondary">
          Alege articolul o dată; linia se adaugă în fiecare rețetă care îl aștepta. Tastele{' '}
          <Tasta>1</Tasta> <Tasta>2</Tasta> <Tasta>3</Tasta> aleg sugestia corespunzătoare.
        </p>
        {!poateEdita && (
          <p className="mt-2 text-sm text-ink-muted">Maparea o face un tehnolog sau un admin.</p>
        )}
      </div>

      <ul className="divide-y divide-line">
        {active.map((intrare) => (
          <RandNemapat
            key={intrare.id}
            intrare={intrare}
            poateEdita={poateEdita}
            seLucreaza={rezolva.isPending && rezolva.variables?.id === intrare.id}
            onRezolva={(codSaga, denumire) =>
              rezolva.mutate({ id: intrare.id, codSaga, denumire })
            }
            onAmana={() => amana.mutate({ id: intrare.id, amanat: true })}
          />
        ))}
      </ul>

      {amanate.length > 0 && (
        <div className="border-t border-line">
          <button
            type="button"
            onClick={() => setAratAmanate((a) => !a)}
            className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-medium text-ink-secondary hover:bg-surface-page"
          >
            <span className={aratAmanate ? 'rotate-90' : ''}>›</span>
            De discutat ({amanate.length})
          </button>
          {aratAmanate && (
            <ul className="divide-y divide-line border-t border-line">
              {amanate.map((intrare) => (
                <RandNemapat
                  key={intrare.id}
                  intrare={intrare}
                  poateEdita={poateEdita}
                  seLucreaza={rezolva.isPending && rezolva.variables?.id === intrare.id}
                  onRezolva={(codSaga, denumire) =>
                    rezolva.mutate({ id: intrare.id, codSaga, denumire })
                  }
                  onAmana={() => amana.mutate({ id: intrare.id, amanat: false })}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function Tasta({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-line-strong bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink-secondary">
      {children}
    </kbd>
  )
}

/** One queued material: the evidence, three keyed suggestions, and a search. */
function RandNemapat({
  intrare,
  poateEdita,
  seLucreaza,
  onRezolva,
  onAmana,
}: {
  intrare: Nemapat
  poateEdita: boolean
  seLucreaza: boolean
  onRezolva: (codSaga: string, denumire: string) => void
  onAmana: () => void
}) {
  const [deschis, setDeschis] = useState(false)

  // The unit the recipe writes is what every suggestion has to be judged
  // against, and it used to be hidden behind a click on „unde apare".
  const unitati = [...new Set(intrare.ocurente.map((o) => o.um.trim()).filter((u) => u !== ''))]
  const umReteta = unitati.length === 1 ? unitati[0] : undefined
  const cantitati = intrare.ocurente.map((o) => Number(o.cantitate)).filter(Number.isFinite)
  const minim = cantitati.length > 0 ? Math.min(...cantitati) : null
  const maxim = cantitati.length > 0 ? Math.max(...cantitati) : null

  const primele = intrare.sugestii.slice(0, 3)

  return (
    <li
      className={`px-5 py-4 ${seLucreaza ? 'opacity-60' : ''}`}
      onKeyDown={(e) => {
        if (!poateEdita || seLucreaza) return
        if (e.target instanceof HTMLInputElement) return
        const index = ['1', '2', '3'].indexOf(e.key)
        const aleasa = index < 0 ? undefined : primele[index]
        if (aleasa !== undefined) {
          e.preventDefault()
          onRezolva(aleasa.codSaga, aleasa.denumire)
        }
      }}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium text-ink">{intrare.denumireExterna}</span>
        {umReteta !== undefined ? (
          <Insigna fel="neutru">{umReteta}</Insigna>
        ) : (
          unitati.length > 1 && <Insigna fel="atentie">UM diferite: {unitati.join(', ')}</Insigna>
        )}
        <span className="text-xs text-ink-muted">
          {intrare.ocurente.length} {intrare.ocurente.length === 1 ? 'rețetă' : 'rețete'}
          {minim !== null && maxim !== null && (
            <> · cant. {minim === maxim ? cant(minim) : `${cant(minim)}–${cant(maxim)}`}</>
          )}
        </span>
        <button
          type="button"
          onClick={() => setDeschis((d) => !d)}
          className="text-xs text-brand underline underline-offset-2"
        >
          {deschis ? 'ascunde' : 'unde apare'}
        </button>
        {poateEdita && (
          <button
            type="button"
            onClick={onAmana}
            className="ml-auto text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            {intrare.amanat ? 'înapoi în coadă' : 'de discutat'}
          </button>
        )}
      </div>

      {deschis && (
        <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
          {intrare.ocurente.map((o) => (
            <li key={`${o.modelCod}-${o.nrLinie}`}>
              {o.modelDenumire} · poziția {o.nrLinie} · {cant(o.cantitate)} {o.um} · {o.grup}
            </li>
          ))}
        </ul>
      )}

      {poateEdita && (
        <>
          <div className="mt-3 flex flex-col gap-1.5">
            {primele.map((s, i) => (
              <button
                key={s.codSaga}
                type="button"
                disabled={seLucreaza}
                onClick={() => onRezolva(s.codSaga, s.denumire)}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line px-3 py-2 text-left hover:border-brand hover:bg-brand-subtle disabled:opacity-50"
              >
                <Tasta>{String(i + 1)}</Tasta>
                <span className="font-mono text-xs text-ink-muted">{s.codSaga}</span>
                <span className="text-sm text-ink">{s.denumire}</span>
                <span className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                  <UmPotrivit um={s.um} asteptat={umReteta} />
                  {s.pretReferinta !== null || s.pretConsum !== null ? (
                    <span>{lei(s.pretReferinta ?? s.pretConsum)} lei</span>
                  ) : (
                    <span className="text-atentie">fără preț</span>
                  )}
                  {s.stoc !== null && Number(s.stoc) !== 0 && <span>stoc {cant(s.stoc)}</span>}
                  <span className="text-ink-disabled">nume {Math.round(s.scor * 100)}%</span>
                </span>
              </button>
            ))}
            {primele.length === 0 && (
              <p className="text-xs text-atentie">
                Nicio sugestie apropiată — caută mai jos după un cuvânt din denumire.
              </p>
            )}
          </div>

          <div className="mt-2">
            <CautaArticol
              umAsteptat={umReteta}
              placeholder="alt articol…"
              clasa="camp camp-mic w-80"
              onAlege={(a) => onRezolva(a.codSaga, a.denumire)}
            />
          </div>
        </>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function PanouImport() {
  const queryClient = useQueryClient()
  const notificari = useNotificari()
  const [raport, setRaport] = useState<Raport | null>(null)
  const [dezactiveazaDisparute, setDezactiveaza] = useState(false)

  const importa = useMutation({
    mutationFn: (fisier: File) =>
      incarcaFisier<Raport>('/nomenclator/import', fisier, {
        dezactiveazaDisparute: String(dezactiveazaDisparute),
      }),
    onSuccess: async (rezultat) => {
      setRaport(rezultat)
      notificari.succes(
        `${rezultat.fisier}: ${rezultat.noi} articole noi, ${rezultat.modificate} modificate.`,
      )
      await queryClient.invalidateQueries({ queryKey: ['nomenclator'] })
    },
    onError: (e) => notificari.eroare(mesajEroare(e)),
  })

  function alegeFisier(eveniment: ChangeEvent<HTMLInputElement>) {
    const fisier = eveniment.target.files?.[0]
    if (fisier !== undefined) importa.mutate(fisier)
    eveniment.target.value = ''
  }

  return (
    <div className="card p-5">
      <h2 className="text-lg font-semibold text-ink">Import nomenclator</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Exportă articolele din SAGA în XLSX și încarcă fișierul aici. Nimic nu se scrie înapoi în
        SAGA.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="buton buton-primar cursor-pointer">
          {importa.isPending ? 'Se importă…' : 'Alege fișier XLSX'}
          <input
            type="file"
            accept=".xlsx"
            onChange={alegeFisier}
            disabled={importa.isPending}
            className="hidden"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          <input
            type="checkbox"
            checked={dezactiveazaDisparute}
            onChange={(e) => setDezactiveaza(e.target.checked)}
          />
          Dezactivează articolele care lipsesc din fișier
        </label>
      </div>
      {dezactiveazaDisparute && (
        <p className="mt-2 text-xs text-atentie">
          Bifează asta doar la un export complet al nomenclatorului. Pe un fișier parțial ar
          dezactiva tot ce nu e în el.
        </p>
      )}

      {raport !== null && <RaportImport raport={raport} dezactivate={dezactiveazaDisparute} />}
    </div>
  )
}

function RaportImport({ raport, dezactivate }: { raport: Raport; dezactivate: boolean }) {
  return (
    <div className="mt-4 space-y-3 rounded-lg border border-line bg-surface-page p-4 text-sm">
      <p className="font-medium text-ink">{raport.fisier}</p>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        <Cifra eticheta="rânduri în fișier" valoare={raport.randuriInFisier} />
        <Cifra eticheta="articole distincte" valoare={raport.articoleInFisier} />
        <Cifra eticheta="noi" valoare={raport.noi} />
        <Cifra eticheta="modificate" valoare={raport.modificate} />
        <Cifra eticheta="neschimbate" valoare={raport.neschimbate} />
        <Cifra eticheta="dispărute" valoare={raport.disparute} />
      </dl>

      {raport.disparute > 0 && (
        <p className="text-ink-secondary">
          {raport.disparute.toLocaleString('ro-RO')} articole din bază nu apar în acest fișier.{' '}
          {dezactivate ? 'Au fost dezactivate.' : 'Nu au fost dezactivate.'}
        </p>
      )}

      {raport.exempleNoi.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase text-ink-muted">Articole noi</p>
          <ul className="mt-1 space-y-0.5 text-ink-secondary">
            {raport.exempleNoi.slice(0, 8).map((e) => (
              <li key={e.codSaga}>
                <span className="font-mono text-xs">{e.codSaga}</span> {e.denumire}
              </li>
            ))}
          </ul>
        </div>
      )}

      {raport.exempleModificate.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase text-ink-muted">Exemple de modificări</p>
          <ul className="mt-1 space-y-0.5 text-ink-secondary">
            {raport.exempleModificate.slice(0, 8).map((e) => (
              <li key={e.codSaga}>
                <span className="font-mono text-xs">{e.codSaga}</span> {e.denumire}{' '}
                <span className="text-ink-muted">({e.schimbari.join(', ')})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {raport.umNecunoscute.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase text-ink-muted">
            Unități pe care aplicația nu le recunoaște
          </p>
          <p className="mt-1 text-ink-secondary">
            {raport.umNecunoscute
              .slice(0, 10)
              .map((u) => `${u.um} (${u.articole})`)
              .join(' · ')}
          </p>
        </div>
      )}
    </div>
  )
}

function Cifra({ eticheta, valoare }: { eticheta: string; valoare: number }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-ink-muted">{eticheta}</dt>
      <dd className="font-medium tabular-nums text-ink">{valoare.toLocaleString('ro-RO')}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

function Catalog() {
  const [cauta, setCauta] = useState('')
  const [cautaAmanat, setCautaAmanat] = useState('')
  const [tip, setTip] = useState('')
  const [categorie, setCategorie] = useState('')
  const [gestiune, setGestiune] = useState('')
  const [pagina, setPagina] = useState(1)

  // Typing in a 24.000-row catalogue should not fire a query per keystroke.
  useEffect(() => {
    const cronometru = setTimeout(() => {
      setCautaAmanat(cauta)
      setPagina(1)
    }, 300)
    return () => clearTimeout(cronometru)
  }, [cauta])

  const filtre = useQuery({
    queryKey: ['nomenclator', 'filtre'],
    queryFn: () => apel<{ categorii: string[]; gestiuni: string[] }>('/nomenclator/filtre'),
    staleTime: 5 * 60_000,
  })

  const articole = useQuery({
    queryKey: ['nomenclator', { cautaAmanat, tip, categorie, gestiune, pagina }],
    queryFn: () => {
      const parametri = new URLSearchParams({
        pagina: String(pagina),
        pePagina: String(PE_PAGINA),
      })
      if (cautaAmanat !== '') parametri.set('cauta', cautaAmanat)
      if (tip !== '') parametri.set('tip', tip)
      if (categorie !== '') parametri.set('categorie', categorie)
      if (gestiune !== '') parametri.set('gestiune', gestiune)
      return apel<Pagina>(`/nomenclator?${parametri.toString()}`)
    },
    placeholderData: keepPreviousData,
  })

  const total = articole.data?.total ?? 0
  const ultimaPagina = Math.max(1, Math.ceil(total / PE_PAGINA))
  const seActualizeaza = articole.isFetching && !articole.isLoading
  const nrColoane = 7

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-ink">Catalog SAGA</h2>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="cauta" className="eticheta">
            Caută
          </label>
          <input
            id="cauta"
            value={cauta}
            onChange={(e) => setCauta(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                setCautaAmanat(cauta)
                setPagina(1)
              }
            }}
            placeholder="denumire sau cod"
            className="camp w-72"
          />
        </div>

        <div>
          <label htmlFor="tip" className="eticheta">
            Tip
          </label>
          <select
            id="tip"
            value={tip}
            onChange={(e) => {
              setTip(e.target.value)
              setPagina(1)
            }}
            className="camp w-44"
          >
            <option value="">toate</option>
            {Object.entries(ETICHETE_TIP).map(([valoare, eticheta]) => (
              <option key={valoare} value={valoare}>
                {eticheta}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="gestiune" className="eticheta">
            Gestiune
          </label>
          <select
            id="gestiune"
            value={gestiune}
            onChange={(e) => {
              setGestiune(e.target.value)
              setPagina(1)
            }}
            className="camp w-44"
          >
            <option value="">toate</option>
            {filtre.data?.gestiuni.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>

        {(filtre.data?.categorii.length ?? 0) > 0 && (
          <div>
            <label htmlFor="categorie" className="eticheta">
              Categorie
            </label>
            <select
              id="categorie"
              value={categorie}
              onChange={(e) => {
                setCategorie(e.target.value)
                setPagina(1)
              }}
              className="camp w-44"
            >
              <option value="">toate</option>
              {filtre.data?.categorii.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}

        <span className="pb-2.5 text-sm text-ink-muted" aria-live="polite">
          {articole.isLoading
            ? 'se încarcă…'
            : seActualizeaza
              ? 'se actualizează…'
              : `${total.toLocaleString('ro-RO')} articole`}
        </span>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm" aria-label="Articole din nomenclatorul SAGA">
          <thead className="sticky top-0 z-10 bg-surface-sunken text-left text-xs uppercase text-ink-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Cod
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Denumire
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                UM
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Tip
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Gestiune
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Preț (lei)
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Stoc
              </th>
            </tr>
          </thead>
          <tbody className={seActualizeaza ? 'opacity-60' : ''}>
            {articole.isLoading && <RanduriSchelet coloane={nrColoane} randuri={8} />}

            {articole.isError && (
              <RandStare coloane={nrColoane}>
                <BannerEroare
                  eroare={articole.error}
                  titlu="Nomenclatorul nu s-a putut încărca."
                  onReincearca={() => void articole.refetch()}
                />
              </RandStare>
            )}

            {articole.data?.articole.map((articol) => (
              <tr key={articol.codSaga} className="border-t border-line hover:bg-surface-page">
                <td className="px-4 py-2 font-mono text-xs">{articol.codSaga}</td>
                <td className="px-4 py-2">{articol.denumire}</td>
                <td className="px-4 py-2">
                  {articol.um.trim() === '' ? (
                    <span className="text-atentie" title="fără UM în SAGA">
                      —
                    </span>
                  ) : (
                    <>
                      {articol.um}
                      {articol.umNormalizat !== null && articol.umNormalizat !== articol.um && (
                        <span className="ml-1 text-xs text-ink-disabled">
                          → {articol.umNormalizat}
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td className="px-4 py-2 text-ink-secondary">
                  {ETICHETE_TIP[articol.tip] ?? articol.tip}
                </td>
                <td className="px-4 py-2 text-ink-secondary">{articol.gestiuneImplicita ?? '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">
                  {lei(articol.pretReferinta)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">
                  {cant(articol.stoc)}
                </td>
              </tr>
            ))}

            {articole.data?.articole.length === 0 && (
              <RandStare coloane={nrColoane}>
                <Gol
                  titlu="Niciun articol pentru filtrele alese"
                  indiciu="Încearcă un cuvânt din mijlocul denumirii sau golește filtrele."
                />
              </RandStare>
            )}
          </tbody>
        </table>
      </div>

      {ultimaPagina > 1 && (
        <div className="flex items-center gap-3 text-sm">
          <button
            type="button"
            disabled={pagina <= 1 || articole.isFetching}
            onClick={() => setPagina(1)}
            className="buton buton-secundar buton-mic"
          >
            Prima
          </button>
          <button
            type="button"
            disabled={pagina <= 1 || articole.isFetching}
            onClick={() => setPagina((p) => p - 1)}
            className="buton buton-secundar buton-mic"
          >
            Înapoi
          </button>
          <span className="text-ink-muted">
            pagina {pagina} din {ultimaPagina.toLocaleString('ro-RO')}
          </span>
          <button
            type="button"
            disabled={pagina >= ultimaPagina || articole.isFetching}
            onClick={() => setPagina((p) => p + 1)}
            className="buton buton-secundar buton-mic"
          >
            Înainte
          </button>
        </div>
      )}
    </div>
  )
}
