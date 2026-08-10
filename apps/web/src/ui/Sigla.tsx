/**
 * The mark, drawn rather than fetched.
 *
 * The word SAMOBI in the original is black, so the full lockup only works on a
 * light surface; that is where it is used. The sofa outline alone carries the
 * brand where the wordmark would be too much — favicon, empty states.
 */

export function SiglaCanapea({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 13V9a2 2 0 0 1 2-2h20a2 2 0 0 1 2 2v4" />
        <path d="M8 13V8.5" />
        <path d="M24 13V8.5" />
        <rect x="2.6" y="13" width="26.8" height="9" rx="2.5" />
        <path d="M6 22v2.5" />
        <path d="M26 22v2.5" />
      </g>
    </svg>
  )
}

/**
 * Full lockup. `inaltime` is a Tailwind height class — the aspect ratio is
 * fixed at the image's own 612×264, so width follows.
 */
export function Sigla({ inaltime = 'h-9' }: { inaltime?: string }) {
  return (
    <img
      src="/samobi.png"
      alt="SAMOBI — Fabrica de canapele"
      className={`${inaltime} w-auto`}
      width={612}
      height={264}
    />
  )
}
