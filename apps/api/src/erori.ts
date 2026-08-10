import type { FastifyInstance } from 'fastify'
import { ZodError } from 'zod'

/**
 * Business errors carry the status the client should see and a Romanian message
 * meant for the user. Anything else becomes a 500 with a generic message —
 * internal failures do not describe themselves to the outside.
 */
export class EroareApi extends Error {
  constructor(
    readonly status: number,
    readonly cod: string,
    mesaj: string,
  ) {
    super(mesaj)
    this.name = new.target.name
  }
}

export class Neautentificat extends EroareApi {
  constructor(mesaj = 'Trebuie să te autentifici.') {
    super(401, 'NEAUTENTIFICAT', mesaj)
  }
}

export class Interzis extends EroareApi {
  constructor(mesaj = 'Nu ai dreptul să faci asta.') {
    super(403, 'INTERZIS', mesaj)
  }
}

export class NuExista extends EroareApi {
  constructor(mesaj = 'Nu am găsit ce ai cerut.') {
    super(404, 'NU_EXISTA', mesaj)
  }
}

export class CerereInvalida extends EroareApi {
  constructor(mesaj: string, readonly detalii?: unknown) {
    super(400, 'CERERE_INVALIDA', mesaj)
  }
}

export class Conflict extends EroareApi {
  constructor(mesaj: string) {
    super(409, 'CONFLICT', mesaj)
  }
}

export function inregistreazaTratareErori(app: FastifyInstance) {
  app.setErrorHandler((err, cerere, raspuns) => {
    if (err instanceof ZodError) {
      return raspuns.status(400).send({
        cod: 'CERERE_INVALIDA',
        mesaj: 'Datele trimise nu sunt valide.',
        detalii: err.issues.map((i) => ({ camp: i.path.join('.'), mesaj: i.message })),
      })
    }

    if (err instanceof EroareApi) {
      if (err.status >= 500) cerere.log.error({ err }, 'eroare interna')
      return raspuns.status(err.status).send({
        cod: err.cod,
        mesaj: err.message,
        ...(err instanceof CerereInvalida && err.detalii !== undefined
          ? { detalii: err.detalii }
          : {}),
      })
    }

    cerere.log.error({ err }, 'eroare netratata')
    return raspuns.status(500).send({
      cod: 'EROARE_INTERNA',
      mesaj: 'A apărut o eroare. Încearcă din nou sau anunță administratorul.',
    })
  })
}
