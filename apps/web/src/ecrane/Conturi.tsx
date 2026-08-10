import { ROLURI } from '@samobi/shared/db'
import type { RandCont, RolValidat, UtilizatorCurent } from '@samobi/shared/scheme'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { apel } from '../lib/api.js'
import { useNotificari } from '../ui/Notificari.js'
import { DESCRIERI_ROL, ETICHETE_ROL } from '../ui/roluri.js'
import {
  BannerEroare,
  Confirma,
  Insigna,
  RanduriSchelet,
  RandStare,
  mesajEroare,
} from '../ui/stari.js'

export function Conturi({ utilizator }: { utilizator: UtilizatorCurent }) {
  const queryClient = useQueryClient()
  const notificari = useNotificari()
  const [email, setEmail] = useState('')
  const [nume, setNume] = useState('')
  const [rol, setRol] = useState<RolValidat>('operator')

  const conturi = useQuery({
    queryKey: ['conturi'],
    queryFn: () => apel<RandCont[]>('/conturi'),
  })

  const reincarca = () => queryClient.invalidateQueries({ queryKey: ['conturi'] })

  const invitatie = useMutation({
    mutationFn: () => apel('/conturi', { metoda: 'POST', corp: { email, nume, rol } }),
    onSuccess: async () => {
      notificari.succes(`Invitația a plecat către ${email}.`)
      setEmail('')
      setNume('')
      await reincarca()
    },
    onError: (e) => notificari.eroare(mesajEroare(e)),
  })

  const schimbaRol = useMutation({
    mutationFn: (v: { id: string; rol: RolValidat; nume: string }) =>
      apel(`/conturi/${v.id}`, { metoda: 'PATCH', corp: { rol: v.rol } }),
    onSuccess: async (_r, v) => {
      notificari.succes(`${v.nume} este acum ${ETICHETE_ROL[v.rol]}.`)
      await reincarca()
    },
    onError: async (e) => {
      notificari.eroare(mesajEroare(e))
      // Put the select back to what the server actually holds.
      await reincarca()
    },
  })

  const comutaActiv = useMutation({
    mutationFn: (v: { id: string; activ: boolean; nume: string }) =>
      apel(`/conturi/${v.id}/${v.activ ? 'dezactivare' : 'reactivare'}`, { metoda: 'POST' }),
    onSuccess: async (_r, v) => {
      notificari.succes(
        v.activ ? `Contul lui ${v.nume} a fost dezactivat.` : `Contul lui ${v.nume} e din nou activ.`,
      )
      await reincarca()
    },
    onError: (e) => notificari.eroare(mesajEroare(e)),
  })

  const reinvita = useMutation({
    mutationFn: (v: { id: string; email: string | null }) =>
      apel(`/conturi/${v.id}/reinvitare`, { metoda: 'POST' }),
    onSuccess: (_r, v) => notificari.succes(`Invitația a fost retrimisă către ${v.email ?? 'cont'}.`),
    onError: (e) => notificari.eroare(mesajEroare(e)),
  })

  function trimiteInvitatie(eveniment: FormEvent) {
    eveniment.preventDefault()
    invitatie.mutate()
  }

  const nrColoane = 5

  return (
    <section className="space-y-8">
      <form onSubmit={trimiteInvitatie} className="card p-5">
        <h2 className="text-lg font-semibold text-ink">Invită un angajat</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Primește un email cu un link. Își alege singur parola — noi nu o vedem niciodată.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="email-invitat" className="eticheta">
              Email
            </label>
            <input
              id="email-invitat"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="camp w-64"
            />
          </div>

          <div>
            <label htmlFor="nume-invitat" className="eticheta">
              Nume
            </label>
            <input
              id="nume-invitat"
              value={nume}
              onChange={(e) => setNume(e.target.value)}
              required
              minLength={2}
              className="camp w-52"
            />
          </div>

          <div>
            <label htmlFor="rol-invitat" className="eticheta">
              Rol
            </label>
            <select
              id="rol-invitat"
              value={rol}
              onChange={(e) => setRol(e.target.value as RolValidat)}
              className="camp w-44"
            >
              {ROLURI.map((r) => (
                <option key={r} value={r}>
                  {ETICHETE_ROL[r]}
                </option>
              ))}
            </select>
          </div>

          <button type="submit" disabled={invitatie.isPending} className="buton buton-primar">
            {invitatie.isPending ? 'Se trimite…' : 'Trimite invitația'}
          </button>
        </div>

        <p className="indiciu mt-2">{DESCRIERI_ROL[rol]}</p>
      </form>

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-ink">Ce poate fiecare rol</h3>
        <dl className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {ROLURI.map((r) => (
            <div key={r} className="flex gap-2 text-sm">
              <dt className="w-28 shrink-0 font-medium text-ink">{ETICHETE_ROL[r]}</dt>
              <dd className="text-ink-secondary">{DESCRIERI_ROL[r]}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm" aria-label="Utilizatori">
          <thead className="bg-surface-sunken text-left text-xs uppercase text-ink-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Nume
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Rol
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Stare
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Creat
              </th>
              <th scope="col" className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {conturi.isLoading && <RanduriSchelet coloane={nrColoane} />}

            {conturi.isError && (
              <RandStare coloane={nrColoane}>
                <BannerEroare
                  eroare={conturi.error}
                  titlu="Utilizatorii nu s-au putut încărca."
                  onReincearca={() => void conturi.refetch()}
                />
              </RandStare>
            )}

            {conturi.data?.map((cont) => {
              const eEu = cont.id === utilizator.id
              const seSchimbaRolul = schimbaRol.isPending && schimbaRol.variables?.id === cont.id
              const seComuta = comutaActiv.isPending && comutaActiv.variables?.id === cont.id
              return (
                <tr key={cont.id} className="border-t border-line hover:bg-surface-page">
                  <td className="px-4 py-3">
                    <span className="text-ink">{cont.nume}</span>
                    {eEu && <span className="ml-2 text-xs text-ink-muted">(tu)</span>}
                    <span className="block text-xs text-ink-muted">{cont.email ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={cont.rol}
                      disabled={eEu || seSchimbaRolul}
                      aria-label={`Rolul lui ${cont.nume}`}
                      onChange={(e) =>
                        schimbaRol.mutate({
                          id: cont.id,
                          rol: e.target.value as RolValidat,
                          nume: cont.nume,
                        })
                      }
                      className="camp camp-mic w-40"
                    >
                      {ROLURI.map((r) => (
                        <option key={r} value={r}>
                          {ETICHETE_ROL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    {!cont.activ ? (
                      <Insigna fel="neutru">Dezactivat</Insigna>
                    ) : cont.invitat ? (
                      <Insigna fel="atentie">Invitat</Insigna>
                    ) : (
                      <Insigna fel="succes">Activ</Insigna>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-ink-muted">
                    {new Date(cont.creatLa).toLocaleDateString('ro-RO')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      {cont.invitat && cont.activ && (
                        <button
                          type="button"
                          disabled={reinvita.isPending}
                          onClick={() => reinvita.mutate({ id: cont.id, email: cont.email })}
                          className="buton buton-secundar buton-mic"
                        >
                          Retrimite invitația
                        </button>
                      )}
                      {cont.activ ? (
                        <Confirma
                          eticheta="Dezactivează"
                          intrebare={`Sigur dezactivezi contul lui ${cont.nume}?`}
                          confirmare="Da, dezactivează"
                          dezactivat={eEu || seComuta}
                          onConfirma={() =>
                            comutaActiv.mutate({ id: cont.id, activ: true, nume: cont.nume })
                          }
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={eEu || seComuta}
                          onClick={() =>
                            comutaActiv.mutate({ id: cont.id, activ: false, nume: cont.nume })
                          }
                          className="buton buton-secundar buton-mic"
                        >
                          Reactivează
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
