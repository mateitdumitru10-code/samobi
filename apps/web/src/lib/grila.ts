import { useCallback, type KeyboardEvent } from 'react'

/**
 * Excel-like movement across an editable grid.
 *
 * The tehnolog filling in forty recipe lines will not reach for the mouse
 * between cells. Cells carry `data-rand` and `data-coloana`, and focus moves by
 * looking the neighbour up in the DOM — no index bookkeeping to drift out of
 * sync with the rendered table.
 */

export function coordonate(rand: number, coloana: number) {
  return { 'data-rand': rand, 'data-coloana': coloana }
}

function focuseaza(container: HTMLElement | null, rand: number, coloana: number): boolean {
  const tinta = container?.querySelector<HTMLElement>(
    `[data-rand="${rand}"][data-coloana="${coloana}"]`,
  )
  if (tinta === null || tinta === undefined) return false
  tinta.focus()
  if (tinta instanceof HTMLInputElement && tinta.type === 'text') tinta.select()
  return true
}

export function useNavigareGrila(container: () => HTMLElement | null) {
  return useCallback(
    (eveniment: KeyboardEvent<HTMLElement>) => {
      const element = eveniment.currentTarget
      const rand = Number(element.dataset['rand'])
      const coloana = Number(element.dataset['coloana'])
      if (Number.isNaN(rand) || Number.isNaN(coloana)) return

      // Inside a select, up and down pick options; leave them alone.
      const esteSelect = element instanceof HTMLSelectElement

      let tintaRand = rand
      let tintaColoana = coloana

      switch (eveniment.key) {
        case 'ArrowDown':
          if (esteSelect) return
          tintaRand += 1
          break
        case 'ArrowUp':
          if (esteSelect) return
          tintaRand -= 1
          break
        case 'Enter':
          tintaRand += 1
          break
        case 'ArrowRight':
          // Only jump cells from the end of the text, so arrows still move the
          // caret inside a value being edited.
          if (
            element instanceof HTMLInputElement &&
            element.selectionStart !== element.value.length
          ) {
            return
          }
          tintaColoana += 1
          break
        case 'ArrowLeft':
          if (element instanceof HTMLInputElement && element.selectionStart !== 0) return
          tintaColoana -= 1
          break
        default:
          return
      }

      if (focuseaza(container(), tintaRand, tintaColoana)) {
        eveniment.preventDefault()
      }
    },
    [container],
  )
}
