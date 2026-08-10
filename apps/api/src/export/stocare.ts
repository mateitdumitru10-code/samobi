import { supabaseAdmin } from '../supabase.js'

/**
 * The bucket holding generated XLSX files.
 *
 * Private, always. A bon lists what the company builds and what it costs; a
 * public bucket would put that behind a guessable URL. Downloads go through a
 * signed link the API issues after checking the role.
 */
export const BUCKET_EXPORTURI = 'exporturi'

/** Long enough to click, short enough that a leaked link is worthless. */
export const SECUNDE_LINK = 60

let asigurat = false

export async function asiguraBucket(): Promise<void> {
  if (asigurat) return

  const { data, error } = await supabaseAdmin.storage.getBucket(BUCKET_EXPORTURI)

  if (error === null && data !== null) {
    if (data.public) {
      // Never silently accept a public bucket: fix it and say so.
      await supabaseAdmin.storage.updateBucket(BUCKET_EXPORTURI, { public: false })
    }
    asigurat = true
    return
  }

  const { error: eroareCreare } = await supabaseAdmin.storage.createBucket(BUCKET_EXPORTURI, {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
    allowedMimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
  })

  // A parallel request may have won the race; that is fine.
  if (eroareCreare !== null && !/already exists/i.test(eroareCreare.message)) {
    throw new Error(`Bucketul de exporturi nu a putut fi creat: ${eroareCreare.message}`)
  }

  asigurat = true
}

export async function incarcaExport(cale: string, continut: Buffer): Promise<void> {
  await asiguraBucket()

  const { error } = await supabaseAdmin.storage.from(BUCKET_EXPORTURI).upload(cale, continut, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    upsert: false,
  })

  if (error !== null) throw new Error(`Fișierul nu a putut fi salvat: ${error.message}`)
}

export async function linkSemnat(cale: string, numeDescarcare: string): Promise<string> {
  await asiguraBucket()

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_EXPORTURI)
    .createSignedUrl(cale, SECUNDE_LINK, { download: numeDescarcare })

  if (error !== null || data === null) {
    throw new Error(`Linkul de descărcare nu a putut fi generat: ${error?.message ?? ''}`)
  }
  return data.signedUrl
}
