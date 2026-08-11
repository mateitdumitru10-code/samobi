import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { apel } from '../lib/api.js'

import type { ArticolGasit } from './CautaArticol.js'
import { cant, normalizeazaZecimala } from './numere.js'

/**
 * Choosing the fabric when the bon is issued.
 *
 * No product has a fixed fabric — the recipe gives the metreage and the cover
 * is decided per order — so this is the one decision on the screen that happens
 * every single time, and it has to be faster than everything around it.
 *
 * Three ways in, in the order they are actually used:
 *
 *   1. „Toată piesa în:" — one choice fills every fabric line at once. A sofa
 *      has three or four of them and they are almost always the same fabric.
 *   2. The chips: what the workshop uses most, counted over the recipes, one
 *      click each. Nothing to type on the common case.
 *   3. Per line, for the piece that goes in a second fabric, with the fabric
 *      the recipe was imported with offered as the first suggestion.
 *
 * So is the number of lines. A model with two fabric lines is sometimes
 * upholstered in one, and an order sometimes needs a material the recipe never
 * had; both are facts about the order, not about the model, and neither is
 * worth a new version of the recipe. A dropped line stays on screen, greyed,
 * with the way back one click away.
 *
 * The metreage is a suggestion, not a law. The recipe recorded what one run
 * consumed on one roll; the next fabric is a different width and cuts
 * differently, so the figure is editable here and carries `sursa = manual`
 * into the bon when it is touched.
 *
 * The search starts on the fabrics and can be widened to the whole catalogue,
 * because a fabric bought yesterday is not going to wait for anyone to update
 * a rule about names.
 */

export interface LinieStofa {
  id: string
  nrLinie: number
  grup: string
  um: string
  cantitate: string | null
  stofaAnterioaraCod: string | null
  stofaAnterioaraDenumire: string | null
}

interface Stofa extends ArticolGasit {
  folosiri: number
}

/** A material added on this bon alone. `cheie` only ever lives in the browser. */
export interface StofaSuplimentara {
  cheie: string
  articol: ArticolGasit | null
  cantitate: string
}

/** Chips fit one row on a laptop; more than this is a list, not a shortcut. */
const CHIPS = 8

function useStofe(cauta: string, toate: boolean, activ = true) {
  const [amanat, setAmanat] = useState(cauta)
  useEffect(() => {
    const cronometru = setTimeout(() => setAmanat(cauta), 200)
    return () => clearTimeout(cronometru)
  }, [cauta])

  return useQuery({
    queryKey: ['stofe', amanat, toate],
    queryFn: () =>
      apel<{ stofe: Stofa[]; total: number }>(
        `/nomenclator/stofe?${new URLSearchParams({
          ...(amanat.trim() === '' ? {} : { cauta: amanat.trim() }),
          ...(toate ? { toate: 'true' } : {}),
          limita: '30',
        }).toString()}`,
      ),
    enabled: activ,
    staleTime: 5 * 60_000,
  })
}

export function AlegeStofe({
  linii,
  alese,
  bucati,
  cantitati,
  onAlege,
  onAlegeToate,
  onSterge,
  onCantitate,
  onResetCantitate,
  excluse,
  onExclude,
  onInclude,
  suplimentare,
  onAdaugaSuplimentar,
  onSchimbaSuplimentar,
  onStergeSuplimentar,
}: {
  linii: LinieStofa[]
  alese: Record<string, ArticolGasit>
  /** how many products the bon covers — the metreage below is per product */
  bucati: number
  /** recipe line id → the metreage as typed here; absent means „ca în rețetă" */
  cantitati: Record<string, string>
  onAlege: (linieId: string, stofa: ArticolGasit) => void
  onAlegeToate: (stofa: ArticolGasit) => void
  onSterge: (linieId: string) => void
  onCantitate: (linieId: string, valoare: string) => void
  onResetCantitate: (linieId: string) => void
  /** recipe line ids this bon does not use */
  excluse: readonly string[]
  onExclude: (linieId: string) => void
  onInclude: (linieId: string) => void
  suplimentare: readonly StofaSuplimentara[]
  onAdaugaSuplimentar: () => void
  onSchimbaSuplimentar: (cheie: string, modificare: Partial<StofaSuplimentara>) => void
  onStergeSuplimentar: (cheie: string) => void
}) {
  const populare = useStofe('', false)
  const active = linii.filter((l) => !excluse.includes(l.id))
  const numarAlese = active.filter((l) => alese[l.id] !== undefined).length
  const complet = numarAlese === active.length
  const maiMulte = active.length > 1

  /**
   * Whether every line ended up in the same fabric — which is the normal case,
   * and worth saying out loud so nobody re-reads four identical rows.
   */
  const uniforma = useMemo(() => {
    if (!complet || active.length < 2) return null
    const coduri = new Set(active.map((l) => alese[l.id]?.codSaga))
    return coduri.size === 1 ? alese[active[0]?.id ?? '']?.denumire : null
  }, [complet, active, alese])

  const total =
    active.reduce(
      (suma, l) => suma + Number(normalizeazaZecimala(cantitati[l.id] ?? '') ?? l.cantitate ?? 0),
      0,
    ) + suplimentare.reduce((suma, s) => suma + Number(normalizeazaZecimala(s.cantitate) ?? 0), 0)

  return (
    <section className="rounded-lg border border-line bg-surface-sunken p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          Stofa
          <span
            className={`insigna ${
              complet
                ? 'border-succes-border bg-succes-bg text-succes'
                : 'border-line-strong bg-surface text-ink-secondary'
            }`}
          >
            {numarAlese}/{active.length}
            {complet ? ' ✓' : ''}
          </span>
        </h3>
        <p className="text-xs text-ink-muted">
          {/*
            Per product, not per bon. Someone typing „7" for an order of two
            would otherwise be booking fourteen metres without being told.
          */}
          {total > 0 && (
            <>
              {cant(total.toFixed(3))} ML / bucată
              {bucati > 1 && <> · {cant((total * bucati).toFixed(3))} ML pe bon</>} ·{' '}
            </>
          )}
          metrajul din rețetă e o sugestie, se poate schimba
        </p>
      </header>

      {maiMulte && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3">
          <span className="text-sm font-medium text-ink">Toată piesa în:</span>
          <CautaStofa
            onAlege={onAlegeToate}
            placeholder="caută o stofă…"
            latime="w-72"
          />
          <span className="text-xs text-ink-muted">
            completează toate cele {active.length} linii
          </span>
        </div>
      )}

      {(populare.data?.stofe.length ?? 0) > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-ink-secondary">Cele mai folosite</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {populare.data?.stofe.slice(0, CHIPS).map((s) => (
              <li key={s.codSaga}>
                <button
                  type="button"
                  onClick={() => (maiMulte ? onAlegeToate(s) : onAlege(active[0]?.id ?? '', s))}
                  title={`${s.codSaga} · în ${s.folosiri} rețete`}
                  className="insigna border-line-strong bg-surface text-ink-secondary hover:border-brand-border hover:bg-brand-subtle hover:text-brand"
                >
                  {s.denumire}
                  <span className="text-ink-muted">{s.folosiri}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="mt-3 space-y-1.5">
        {linii.map((linie) => (
          <RandStofa
            key={linie.id}
            linie={linie}
            ales={alese[linie.id]}
            cantitate={cantitati[linie.id]}
            onAlege={(s) => onAlege(linie.id, s)}
            onSterge={() => onSterge(linie.id)}
            onCantitate={(v) => onCantitate(linie.id, v)}
            onResetCantitate={() => onResetCantitate(linie.id)}
            exclusa={excluse.includes(linie.id)}
            onExclude={() => onExclude(linie.id)}
            onInclude={() => onInclude(linie.id)}
          />
        ))}
        {suplimentare.map((s) => (
          <RandSuplimentar
            key={s.cheie}
            stofa={s}
            onSchimba={(modificare) => onSchimbaSuplimentar(s.cheie, modificare)}
            onSterge={() => onStergeSuplimentar(s.cheie)}
          />
        ))}
      </ul>

      <button
        type="button"
        onClick={onAdaugaSuplimentar}
        className="buton buton-discret buton-mic mt-2"
      >
        + adaugă un material
      </button>

      {uniforma != null && (
        <p className="mt-2 text-xs text-succes">Toate liniile în {uniforma}.</p>
      )}
    </section>
  )
}

function RandStofa({
  linie,
  ales,
  cantitate,
  onAlege,
  onSterge,
  onCantitate,
  onResetCantitate,
  exclusa,
  onExclude,
  onInclude,
}: {
  linie: LinieStofa
  ales: ArticolGasit | undefined
  cantitate: string | undefined
  onAlege: (stofa: ArticolGasit) => void
  onSterge: () => void
  onCantitate: (valoare: string) => void
  onResetCantitate: () => void
  exclusa: boolean
  onExclude: () => void
  onInclude: () => void
}) {
  if (exclusa) {
    return (
      <li className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-line bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
        <span className="w-40 shrink-0 line-through">linia {linie.nrLinie}</span>
        <span className="line-through">
          {cant(linie.cantitate)} {linie.um}
        </span>
        <span className="text-xs">nu intră pe bon</span>
        <button
          type="button"
          onClick={onInclude}
          className="text-xs text-brand underline underline-offset-2"
        >
          pune la loc
        </button>
      </li>
    )
  }

  const dinReteta = cant(linie.cantitate)
  const modificata = cantitate !== undefined
  const invalida = modificata && normalizeazaZecimala(cantitate) === null
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
      <span className="w-40 shrink-0 text-ink-secondary">
        {/* Most recipes came out of SAGA without groups; „NECLASIFICAT" on
            every row is four rows of noise and no information. */}
        {linie.grup === 'NECLASIFICAT' ? (
          <span className="text-ink-muted">linia {linie.nrLinie}</span>
        ) : (
          <>
            {linie.grup}
            <span className="text-ink-muted"> · linia {linie.nrLinie}</span>
          </>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {/*
          Not `type="number"`: a scroll wheel over a focused number input
          changes the value in silence, and this one ends up in SAGA.
        */}
        <input
          value={modificata ? cantitate : dinReteta}
          inputMode="decimal"
          aria-label={`Cantitate linia ${linie.nrLinie}`}
          aria-invalid={invalida}
          onChange={(e) => onCantitate(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          className={`camp camp-mic w-20 text-right font-medium tabular-nums ${
            modificata && !invalida ? 'border-brand text-brand' : ''
          }`}
        />
        <span className="text-xs text-ink-muted">{linie.um}</span>
        {modificata && (
          <button
            type="button"
            onClick={onResetCantitate}
            title="Înapoi la metrajul din rețetă"
            className="text-xs text-brand underline underline-offset-2"
          >
            rețeta: {dinReteta}
          </button>
        )}
      </span>

      {ales === undefined ? (
        <span className="flex flex-wrap items-center gap-2">
          <CautaStofa onAlege={onAlege} placeholder="caută o stofă…" latime="w-64" />
          {linie.stofaAnterioaraCod !== null && (
            <UltimaData
              cod={linie.stofaAnterioaraCod}
              denumire={linie.stofaAnterioaraDenumire ?? linie.stofaAnterioaraCod}
              um={linie.um}
              onAlege={onAlege}
            />
          )}
        </span>
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          <span className="insigna border-brand-border bg-brand-subtle text-brand">
            {ales.denumire}
          </span>
          <span className="font-mono text-xs text-ink-muted">{ales.codSaga}</span>
          {ales.um.trim().toUpperCase() !== linie.um.trim().toUpperCase() && (
            <span className="text-xs text-atentie" title={`Rețeta scrie ${linie.um}`}>
              {ales.um} ≠ {linie.um}
            </span>
          )}
          <button
            type="button"
            onClick={onSterge}
            className="text-xs text-brand underline underline-offset-2"
          >
            schimbă
          </button>
        </span>
      )}

      <button
        type="button"
        onClick={onExclude}
        title="Scoate linia de pe bonul acesta. Rețeta rămâne neatinsă."
        className="ml-auto text-xs text-ink-muted underline underline-offset-2 hover:text-danger"
      >
        scoate
      </button>
    </li>
  )
}

/** A material this bon adds. No recipe line behind it, so nothing to fall back on. */
function RandSuplimentar({
  stofa,
  onSchimba,
  onSterge,
}: {
  stofa: StofaSuplimentara
  onSchimba: (modificare: Partial<StofaSuplimentara>) => void
  onSterge: () => void
}) {
  const invalida = stofa.cantitate.trim() !== '' && normalizeazaZecimala(stofa.cantitate) === null

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-brand-border bg-brand-subtle px-3 py-2 text-sm">
      <span className="w-40 shrink-0 text-ink-secondary">în plus pe bon</span>
      <span className="flex shrink-0 items-center gap-1.5">
        <input
          value={stofa.cantitate}
          inputMode="decimal"
          aria-label="Cantitate material suplimentar"
          aria-invalid={invalida}
          placeholder="0"
          onChange={(e) => onSchimba({ cantitate: e.target.value })}
          className="camp camp-mic w-20 text-right font-medium tabular-nums"
        />
        <span className="text-xs text-ink-muted">{stofa.articol?.um ?? ''}</span>
      </span>

      {stofa.articol === null ? (
        <CautaStofa
          onAlege={(articol) => onSchimba({ articol })}
          placeholder="caută materialul…"
          latime="w-64"
        />
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          <span className="insigna border-brand-border bg-surface text-brand">
            {stofa.articol.denumire}
          </span>
          <span className="font-mono text-xs text-ink-muted">{stofa.articol.codSaga}</span>
          <button
            type="button"
            onClick={() => onSchimba({ articol: null })}
            className="text-xs text-brand underline underline-offset-2"
          >
            schimbă
          </button>
        </span>
      )}

      <button
        type="button"
        onClick={onSterge}
        className="ml-auto text-xs text-ink-muted underline underline-offset-2 hover:text-danger"
      >
        scoate
      </button>
    </li>
  )
}

/**
 * The fabric this recipe was imported with. Not a default — nothing is fixed —
 * but the fastest correct answer when a bon repeats last month's order.
 */
function UltimaData({
  cod,
  denumire,
  um,
  onAlege,
}: {
  cod: string
  denumire: string
  um: string
  onAlege: (stofa: ArticolGasit) => void
}) {
  return (
    <button
      type="button"
      onClick={() =>
        onAlege({
          codSaga: cod,
          denumire,
          um,
          tip: 'materie_prima',
          pretReferinta: null,
          pretConsum: null,
          stoc: null,
        })
      }
      title={`Stofa cu care a fost importată rețeta — ${cod}`}
      className="buton buton-discret buton-mic border border-dashed border-line-strong"
    >
      ultima dată: {denumire}
    </button>
  )
}

/**
 * A fabric picker that shows the list before anything is typed.
 *
 * `CautaArticol` waits for two characters, which is right for twenty-four
 * thousand articles and wrong here: the fabric is usually one of a dozen, and
 * making someone type to see them costs more than it saves.
 */
export function CautaStofa({
  onAlege,
  placeholder = 'caută o stofă…',
  latime = 'w-72',
}: {
  onAlege: (stofa: ArticolGasit) => void
  placeholder?: string
  latime?: string
}) {
  const [text, setText] = useState('')
  const [toate, setToate] = useState(false)
  const [deschis, setDeschis] = useState(false)
  const [activ, setActiv] = useState(0)
  const idLista = useId()
  const containerRef = useRef<HTMLDivElement>(null)

  const rezultate = useStofe(text, toate, deschis)
  const stofe = rezultate.data?.stofe ?? []
  const total = rezultate.data?.total ?? 0

  useEffect(() => setActiv(0), [text, toate])

  function alege(stofa: ArticolGasit | undefined) {
    if (stofa === undefined) return
    onAlege(stofa)
    setText('')
    setToate(false)
    setDeschis(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setDeschis(true)
        }}
        onFocus={() => setDeschis(true)}
        onBlur={(e) => {
          // The click on a result has not landed yet when blur fires.
          if (!containerRef.current?.contains(e.relatedTarget)) {
            setTimeout(() => setDeschis(false), 150)
          }
        }}
        onKeyDown={(e) => {
          if (!deschis || stofe.length === 0) {
            if (e.key === 'Escape') setDeschis(false)
            return
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActiv((i) => Math.min(i + 1, stofe.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActiv((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            alege(stofe[activ])
          } else if (e.key === 'Escape') {
            setText('')
            setDeschis(false)
          }
        }}
        role="combobox"
        aria-expanded={deschis}
        aria-controls={idLista}
        aria-autocomplete="list"
        placeholder={placeholder}
        className={`camp camp-mic ${latime}`}
      />

      {deschis && (
        <div
          className="absolute z-20 mt-1 w-[24rem] overflow-hidden rounded-lg border border-line bg-surface shadow-[0_8px_24px_rgb(28_25_23/0.12)]"
          onMouseDown={(e) => e.preventDefault()}
        >
          <ul id={idLista} role="listbox" className="max-h-72 overflow-y-auto">
            {rezultate.isFetching && stofe.length === 0 && (
              <li className="px-3 py-2 text-sm text-ink-muted">Se caută…</li>
            )}
            {!rezultate.isFetching && stofe.length === 0 && (
              <li className="px-3 py-3 text-sm text-ink-muted">
                {toate ? (
                  <>Niciun articol pentru „{text}".</>
                ) : (
                  <>
                    Nicio stofă pentru „{text}".
                    <span className="mt-1 block text-xs">
                      Dacă e o stofă nouă, bifează „caută în tot nomenclatorul".
                    </span>
                  </>
                )}
              </li>
            )}
            {stofe.map((s, i) => (
              <li key={s.codSaga} role="option" aria-selected={i === activ}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setActiv(i)}
                  onClick={() => alege(s)}
                  className={`flex w-full items-baseline gap-2 px-3 py-2 text-left ${
                    i === activ ? 'bg-brand-subtle' : ''
                  }`}
                >
                  <span className="grow text-sm text-ink">{s.denumire}</span>
                  <span className="font-mono text-xs text-ink-muted">{s.codSaga}</span>
                  {s.folosiri > 0 && (
                    <span className="text-xs text-ink-muted" title="rețete care o folosesc">
                      {s.folosiri}×
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          <label className="flex items-center gap-2 border-t border-line bg-surface-sunken px-3 py-2 text-xs text-ink-secondary">
            <input
              type="checkbox"
              checked={toate}
              onChange={(e) => setToate(e.target.checked)}
              className="size-3.5"
            />
            caută în tot nomenclatorul
            <span className="ml-auto text-ink-muted">
              {total > stofe.length ? `${stofe.length} din ${total}` : `${total}`}
            </span>
          </label>
        </div>
      )}
    </div>
  )
}
