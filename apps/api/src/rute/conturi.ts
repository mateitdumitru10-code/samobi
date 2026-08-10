import { profile } from '@samobi/shared/db'
import { schemaInvitatie, schemaModificareCont } from '@samobi/shared/scheme'
import { asc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { scrieAudit } from '../audit.js'
import { autentifica, ceruRol, utilizatorul, type VerificatorToken } from '../auth.js'
import { db } from '../db.js'
import { CerereInvalida, Conflict, NuExista } from '../erori.js'
import { supabaseAdmin } from '../supabase.js'
import { urlActivare } from '../env.js'

const schemaParametruId = z.object({ id: z.string().uuid('Identificator invalid.') })

/** Long enough that a stale session cannot outlive a ban in practice. */
const DURATA_BAN = '876000h'

export function ruteConturi(app: FastifyInstance, verifica: VerificatorToken) {
  const doarAdmin = { preHandler: [autentifica(verifica), ceruRol('admin')] }

  app.get('/conturi', doarAdmin, async () => {
    const randuri = await db
      .select({
        id: profile.id,
        nume: profile.nume,
        rol: profile.rol,
        activ: profile.activ,
        creatLa: profile.creatLa,
      })
      .from(profile)
      .orderBy(asc(profile.nume))

    return randuri.map((r) => ({ ...r, creatLa: r.creatLa.toISOString() }))
  })

  /**
   * Invitation, not registration. Supabase Auth sends the email, the employee
   * sets their own password, and the trigger on auth.users creates the profile
   * row with the role carried in metadata. No password ever passes through here.
   */
  app.post('/conturi', doarAdmin, async (cerere, raspuns) => {
    const { email, nume, rol } = schemaInvitatie.parse(cerere.body)
    const admin = utilizatorul(cerere)

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { nume, rol, creat_de: admin.id },
      redirectTo: urlActivare,
    })

    if (error !== null) {
      if (error.status === 422 || /already/i.test(error.message)) {
        throw new Conflict('Există deja un cont cu acest email.')
      }
      throw new CerereInvalida(`Invitația nu a putut fi trimisă: ${error.message}`)
    }

    const idNou = data.user?.id ?? email
    await scrieAudit(cerere, {
      userId: admin.id,
      entitate: 'profile',
      entitateId: idNou,
      actiune: 'creare_cont',
      diff: { email, nume, rol },
    })

    return raspuns.status(201).send({ id: idNou, email, nume, rol })
  })

  app.patch('/conturi/:id', doarAdmin, async (cerere) => {
    const { id } = schemaParametruId.parse(cerere.params)
    const modificari = schemaModificareCont.parse(cerere.body)
    const admin = utilizatorul(cerere)

    const [inainte] = await db.select().from(profile).where(eq(profile.id, id)).limit(1)
    if (inainte === undefined) throw new NuExista('Contul nu există.')

    // An admin who demotes themselves locks everyone out of user management.
    if (id === admin.id && modificari.rol !== undefined && modificari.rol !== 'admin') {
      throw new CerereInvalida('Nu îți poți schimba propriul rol de administrator.')
    }

    const [dupa] = await db
      .update(profile)
      .set({
        ...(modificari.nume !== undefined ? { nume: modificari.nume } : {}),
        ...(modificari.rol !== undefined ? { rol: modificari.rol } : {}),
      })
      .where(eq(profile.id, id))
      .returning()

    if (modificari.rol !== undefined && modificari.rol !== inainte.rol) {
      // Metadata is what the trigger reads if the account is ever recreated.
      await supabaseAdmin.auth.admin.updateUserById(id, {
        user_metadata: { rol: modificari.rol },
      })
      await scrieAudit(cerere, {
        userId: admin.id,
        entitate: 'profile',
        entitateId: id,
        actiune: 'schimbare_rol',
        diff: { inainte: inainte.rol, dupa: modificari.rol },
      })
    }

    return dupa
  })

  /**
   * Deactivation is two steps, and skipping the second one is the classic bug:
   * `activ = false` stops new authorisations, but sessions already issued keep
   * working until their token expires. The ban invalidates those too.
   */
  app.post('/conturi/:id/dezactivare', doarAdmin, async (cerere) => {
    const { id } = schemaParametruId.parse(cerere.params)
    const admin = utilizatorul(cerere)

    if (id === admin.id) throw new CerereInvalida('Nu îți poți dezactiva propriul cont.')

    const [cont] = await db.select().from(profile).where(eq(profile.id, id)).limit(1)
    if (cont === undefined) throw new NuExista('Contul nu există.')

    await db.update(profile).set({ activ: false }).where(eq(profile.id, id))

    const { error } = await supabaseAdmin.auth.admin.updateUserById(id, {
      ban_duration: DURATA_BAN,
    })
    if (error !== null) {
      // Roll back rather than leave a half-deactivated account: `activ = false`
      // with live sessions is worse than a visible failure.
      await db.update(profile).set({ activ: true }).where(eq(profile.id, id))
      throw new CerereInvalida(`Contul nu a putut fi dezactivat: ${error.message}`)
    }

    await scrieAudit(cerere, {
      userId: admin.id,
      entitate: 'profile',
      entitateId: id,
      actiune: 'dezactivare_cont',
      diff: { nume: cont.nume, rol: cont.rol },
    })

    return { id, activ: false }
  })

  app.post('/conturi/:id/reactivare', doarAdmin, async (cerere) => {
    const { id } = schemaParametruId.parse(cerere.params)
    const admin = utilizatorul(cerere)

    const [cont] = await db.select().from(profile).where(eq(profile.id, id)).limit(1)
    if (cont === undefined) throw new NuExista('Contul nu există.')

    const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: 'none' })
    if (error !== null) {
      throw new CerereInvalida(`Contul nu a putut fi reactivat: ${error.message}`)
    }
    await db.update(profile).set({ activ: true }).where(eq(profile.id, id))

    await scrieAudit(cerere, {
      userId: admin.id,
      entitate: 'profile',
      entitateId: id,
      actiune: 'reactivare_cont',
    })

    return { id, activ: true }
  })
}
