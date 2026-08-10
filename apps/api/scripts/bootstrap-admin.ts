import { schemaInvitatie } from '@samobi/shared/scheme'

import { supabaseAdmin } from '../src/supabase.js'
import { env } from '../src/env.js'

/**
 * Creates the first administrator.
 *
 * Every other account is invited from inside the application, by an admin. This
 * script exists only to break the bootstrap circle, and refuses to run once an
 * admin already exists.
 *
 *   pnpm --filter @samobi/api bootstrap-admin -- email@exemplu.ro "Nume Prenume"
 */

const [emailBrut, numeBrut] = process.argv.slice(2)

if (emailBrut === undefined) {
  console.error('Folosire: bootstrap-admin -- <email> [nume]')
  process.exit(1)
}

const invitatie = schemaInvitatie.parse({
  email: emailBrut,
  nume: numeBrut ?? emailBrut.split('@')[0],
  rol: 'admin',
})

const { data: existenti, error: eroareListare } = await supabaseAdmin.auth.admin.listUsers()
if (eroareListare !== null) {
  console.error('Nu am putut citi lista de utilizatori:', eroareListare.message)
  process.exit(1)
}

const adminExistent = existenti.users.find((u) => u.user_metadata?.['rol'] === 'admin')
if (adminExistent !== undefined) {
  console.error(
    `Există deja un administrator (${adminExistent.email}). ` +
      'Invită restul conturilor din aplicație.',
  )
  process.exit(1)
}

const redirect = `${env.WEB_ORIGIN.split(',')[0]?.trim() ?? ''}/#/activare`

const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(invitatie.email, {
  data: { nume: invitatie.nume, rol: 'admin' },
  redirectTo: redirect,
})

if (error !== null) {
  console.error(`Invitația a eșuat: ${error.message}`)
  console.error('')
  console.error('Generez în schimb un link de activare, pe care îl poți deschide direct.')

  const alternativa = await supabaseAdmin.auth.admin.generateLink({
    type: 'invite',
    email: invitatie.email,
    options: { data: { nume: invitatie.nume, rol: 'admin' }, redirectTo: redirect },
  })

  if (alternativa.error !== null) {
    console.error('Nici linkul nu a putut fi generat:', alternativa.error.message)
    process.exit(1)
  }
  console.log(alternativa.data.properties.action_link)
  process.exit(0)
}

console.log(`Invitație trimisă către ${invitatie.email}.`)
console.log(`Utilizator: ${data.user?.id ?? '(necunoscut)'}`)
console.log(`Linkul din email duce la ${redirect}`)
