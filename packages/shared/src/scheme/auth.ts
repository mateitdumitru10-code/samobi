import { z } from 'zod'

import { ROLURI } from '../db/schema.js'

/** Shared between API and web, so both ends validate the same shapes. */

export const schemaRol = z.enum(ROLURI)
export type RolValidat = z.infer<typeof schemaRol>

export const schemaLogin = z.object({
  email: z.string().trim().toLowerCase().email('Adresa de email nu este validă.'),
  parola: z.string().min(1, 'Parola este obligatorie.'),
})
export type Login = z.infer<typeof schemaLogin>

export const schemaInvitatie = z.object({
  email: z.string().trim().toLowerCase().email('Adresa de email nu este validă.'),
  nume: z.string().trim().min(2, 'Numele trebuie să aibă cel puțin 2 caractere.').max(120),
  rol: schemaRol,
})
export type Invitatie = z.infer<typeof schemaInvitatie>

export const schemaModificareCont = z
  .object({
    nume: z.string().trim().min(2).max(120).optional(),
    rol: schemaRol.optional(),
  })
  .refine((v) => v.nume !== undefined || v.rol !== undefined, {
    message: 'Nu ai schimbat nimic.',
  })
export type ModificareCont = z.infer<typeof schemaModificareCont>

export interface UtilizatorCurent {
  id: string
  email: string | null
  nume: string
  rol: RolValidat
  activ: boolean
}

export interface RandCont {
  id: string
  nume: string
  rol: RolValidat
  activ: boolean
  creatLa: string
  email: string | null
  /** Invited but never signed in — the link may have expired. */
  invitat: boolean
}
