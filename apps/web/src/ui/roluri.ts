import type { RolValidat } from '@samobi/shared/scheme'

/** One vocabulary for roles: the header said „admin" where Conturi said „Administrator". */
export const ETICHETE_ROL: Record<RolValidat, string> = {
  admin: 'Administrator',
  tehnolog: 'Tehnolog',
  operator: 'Operator',
  contabil: 'Contabil',
}

export const DESCRIERI_ROL: Record<RolValidat, string> = {
  admin: 'Tot, inclusiv utilizatorii și aprobarea rețetelor.',
  tehnolog: 'Modele, rețete și nomenclator. Nu emite bonuri.',
  operator: 'Emite bonuri de producție și exportă pentru SAGA.',
  contabil: 'Vede rapoartele și exportă. Nu emite bonuri.',
}
