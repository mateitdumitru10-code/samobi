import type { RolValidat } from '@samobi/shared/scheme'

/** One vocabulary for roles: the header said „admin" where Conturi said „Administrator". */
export const ETICHETE_ROL: Record<RolValidat, string> = {
  admin: 'Administrator',
  tehnolog: 'Tehnolog',
  operator: 'Operator',
  contabil: 'Contabil',
}

/**
 * The role no longer decides what someone may do with recipes, bons or the
 * catalogue — everyone signed in does all of it. It decides one thing: who may
 * invite and deactivate people. The labels stay because a list of colleagues is
 * easier to read when it says what each of them is here for.
 */
export const DESCRIERI_ROL: Record<RolValidat, string> = {
  admin: 'Tot, plus invitarea și dezactivarea conturilor.',
  tehnolog: 'Tot, în afară de conturi.',
  operator: 'Tot, în afară de conturi.',
  contabil: 'Tot, în afară de conturi.',
}
