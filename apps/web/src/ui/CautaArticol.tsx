import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

import { apel } from '../lib/api.js'

import { lei } from './numere.js'

/**
 * Picking one article out of twenty-four thousand.
 *
 * Every screen had grown its own version of this — one that took only a typed
 * code from memory, one that could not be driven from the keyboard, one that
 * quietly filtered to `tip=materie_prima` and so could never find a fabric SAGA
 * files under `marfa`. This is the one, and it shows what the decision actually
 * needs: unit first, because the unit is what makes an export land wrong, then
 * price and stock, because an article with neither is almost never the one the
 * workshop consumes.
 */

export interface ArticolGasit {
  codSaga: string
  denumire: string
  um: string
  tip: string
  pretReferinta: string | null
  pretConsum: string | null
  stoc: string | null
}

const ETICHETE_TIP: Record<string, string> = {
  produs: 'Produs',
  materie_prima: 'Materie primă',
  marfa: 'Marfă',
  altele: 'Altele',
}

export function CautaArticol({
  onAlege,
  umAsteptat,
  placeholder = 'caută după denumire sau cod…',
  autoFocus = false,
  clasa = 'camp camp-mic w-72',
  onTastaLibera,
  ...rest
}: {
  onAlege: (articol: ArticolGasit) => void
  /** The recipe's unit, when there is one: matches are marked, mismatches warned. */
  umAsteptat?: string | undefined
  placeholder?: string
  autoFocus?: boolean
  clasa?: string
  /**
   * Keys the picker did not use. Inside the recipe grid the arrows have to
   * carry on moving between cells whenever the suggestion list is not open,
   * or the material column becomes a dead end for the keyboard.
   */
  onTastaLibera?: ((eveniment: KeyboardEvent<HTMLInputElement>) => void) | undefined
} & Record<`data-${string}`, unknown>) {
  const [text, setText] = useState('')
  const [amanat, setAmanat] = useState('')
  const [activ, setActiv] = useState(0)
  const [deschis, setDeschis] = useState(false)
  const idLista = useId()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const cronometru = setTimeout(() => setAmanat(text), 250)
    return () => clearTimeout(cronometru)
  }, [text])

  const rezultate = useQuery({
    // No `tip` filter: fabrics are often booked as `marfa`, and filtering them
    // out made the article impossible to find with no explanation on screen.
    queryKey: ['cauta-articol', amanat],
    queryFn: () =>
      apel<{ articole: ArticolGasit[] }>(
        `/nomenclator?${new URLSearchParams({
          cauta: amanat,
          doarUtilizabile: 'true',
          pePagina: '8',
        }).toString()}`,
      ),
    enabled: amanat.trim().length >= 2,
  })

  const articole = rezultate.data?.articole ?? []
  const cauta = amanat.trim().length >= 2

  useEffect(() => setActiv(0), [amanat])

  function alege(articol: ArticolGasit | undefined) {
    if (articol === undefined) return
    onAlege(articol)
    setText('')
    setAmanat('')
    setDeschis(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        {...rest}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => {
          setText(e.target.value)
          setDeschis(true)
        }}
        onFocus={() => setDeschis(true)}
        onBlur={(e) => {
          // Closing on blur would fire before the click on a result lands.
          if (!containerRef.current?.contains(e.relatedTarget)) setTimeout(() => setDeschis(false), 120)
        }}
        onKeyDown={(e) => {
          const listaDeschisa = deschis && cauta && articole.length > 0
          if (listaDeschisa && e.key === 'ArrowDown') {
            e.preventDefault()
            setActiv((i) => Math.min(i + 1, articole.length - 1))
            return
          }
          if (listaDeschisa && e.key === 'ArrowUp') {
            e.preventDefault()
            setActiv((i) => Math.max(i - 1, 0))
            return
          }
          if (listaDeschisa && e.key === 'Enter') {
            e.preventDefault()
            alege(articole[activ])
            return
          }
          if (e.key === 'Escape') {
            setText('')
            setDeschis(false)
            return
          }
          onTastaLibera?.(e)
        }}
        role="combobox"
        aria-expanded={deschis && cauta}
        aria-controls={idLista}
        aria-autocomplete="list"
        placeholder={placeholder}
        className={clasa}
      />

      {deschis && cauta && (
        <ul
          id={idLista}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-[26rem] overflow-y-auto rounded-lg border border-line bg-surface shadow-[0_8px_24px_rgb(28_25_23/0.12)]"
        >
          {rezultate.isFetching && articole.length === 0 && (
            <li className="px-3 py-2 text-sm text-ink-muted">Se caută…</li>
          )}
          {!rezultate.isFetching && articole.length === 0 && (
            <li className="px-3 py-3 text-sm text-ink-muted">
              Niciun articol pentru „{amanat}".
              <span className="mt-1 block text-xs">
                Încearcă un cuvânt din mijlocul denumirii, fără prescurtări.
              </span>
            </li>
          )}
          {articole.map((a, i) => (
            <li key={a.codSaga} role="option" aria-selected={i === activ}>
              <button
                type="button"
                tabIndex={-1}
                onMouseEnter={() => setActiv(i)}
                onClick={() => alege(a)}
                className={`w-full px-3 py-2 text-left ${i === activ ? 'bg-brand-subtle' : ''}`}
              >
                <span className="block text-sm text-ink">{a.denumire}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                  <span className="font-mono">{a.codSaga}</span>
                  <UmPotrivit um={a.um} asteptat={umAsteptat} />
                  {a.pretReferinta !== null || a.pretConsum !== null ? (
                    <span>{lei(a.pretReferinta ?? a.pretConsum)} lei</span>
                  ) : (
                    <span className="text-atentie">fără preț</span>
                  )}
                  {a.stoc !== null && Number(a.stoc) !== 0 && <span>stoc {a.stoc}</span>}
                  <span>{ETICHETE_TIP[a.tip] ?? a.tip}</span>
                </span>
              </button>
            </li>
          ))}
          {articole.length === 8 && (
            <li className="border-t border-line px-3 py-1.5 text-xs text-ink-muted">
              primele 8 — scrie mai mult ca să restrângi
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

/** The unit, and whether it is the one the recipe writes. */
export function UmPotrivit({ um, asteptat }: { um: string; asteptat?: string | undefined }) {
  const curat = um.trim()
  if (curat === '') return <span className="text-atentie">fără UM</span>
  if (asteptat === undefined || asteptat.trim() === '') return <span>{curat}</span>

  const potrivit = curat.toUpperCase() === asteptat.trim().toUpperCase()
  return potrivit ? (
    <span className="text-succes">{curat} ✓</span>
  ) : (
    <span className="text-atentie" title={`Rețeta scrie ${asteptat}`}>
      {curat} ≠ {asteptat}
    </span>
  )
}
