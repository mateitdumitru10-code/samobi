import { supabaseAdmin } from '../src/supabase.js'
import { urlActivare } from '../src/env.js'

/**
 * Prints an activation link instead of sending it by email.
 *
 * Useful while the app runs on localhost: the emailed link points at a host that
 * only exists on the developer's machine, so receiving that mail on a phone is
 * no help. Also a way around the default SMTP quota.
 *
 *   pnpm --filter @samobi/api link-activare -- email@exemplu.ro
 */

const email = process.argv[2]
if (email === undefined) {
  console.error('Folosire: link-activare -- <email>')
  process.exit(1)
}

const redirectTo = urlActivare

// 'invite' works only for an account that has never signed in. 'recovery' is the
// fallback: it also lands on a screen where a password is chosen.
for (const type of ['invite', 'recovery'] as const) {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type,
    email,
    options: { redirectTo },
  })

  if (error === null) {
    console.log(`tip: ${type}`)
    console.log(data.properties.action_link)
    process.exit(0)
  }
  console.error(`${type}: ${error.message}`)
}

console.error('Nu am putut genera niciun link.')
process.exit(1)
