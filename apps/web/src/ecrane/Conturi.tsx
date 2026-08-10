import { ROLURI } from '@samobi/shared/db'
import type { RandCont, RolValidat, UtilizatorCurent } from '@samobi/shared/scheme'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { apel, EroareApi } from '../lib/api.js'

const ETICHETE_ROL: Record<RolValidat, string> = {
  admin: 'Administrator',
  tehnolog: 'Tehnolog',
  operator: 'Operator',
  contabil: 'Contabil',
}

export function Conturi({ utilizator }: { utilizator: UtilizatorCurent }) {
  const queryClient = useQueryClient()
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
      setEmail('')
      setNume('')
      await reincarca()
    },
  })

  const schimbaRol = useMutation({
    mutationFn: (v: { id: string; rol: RolValidat }) =>
      apel(`/conturi/${v.id}`, { metoda: 'PATCH', corp: { rol: v.rol } }),
    onSuccess: reincarca,
  })

  const comutaActiv = useMutation({
    mutationFn: (v: { id: string; activ: boolean }) =>
      apel(`/conturi/${v.id}/${v.activ ? 'dezactivare' : 'reactivare'}`, { metoda: 'POST' }),
    onSuccess: reincarca,
  })

  function trimiteInvitatie(eveniment: FormEvent) {
    eveniment.preventDefault()
    invitatie.mutate()
  }

  const eroare = [invitatie.error, schimbaRol.error, comutaActiv.error].find(
    (e): e is EroareApi => e instanceof EroareApi,
  )

  return (
    <section className="space-y-8">
      <form
        onSubmit={trimiteInvitatie}
        className="rounded-lg border border-neutral-200 bg-white p-5"
      >
        <h2 className="text-sm font-semibold text-neutral-900">Invită un angajat</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Primește un email cu un link. Își alege singur parola — noi nu o vedem niciodată.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="block text-xs font-medium text-neutral-600">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-64 rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />
          </label>

          <label className="space-y-1">
            <span className="block text-xs font-medium text-neutral-600">Nume</span>
            <input
              value={nume}
              onChange={(e) => setNume(e.target.value)}
              required
              minLength={2}
              className="w-52 rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />
          </label>

          <label className="space-y-1">
            <span className="block text-xs font-medium text-neutral-600">Rol</span>
            <select
              value={rol}
              onChange={(e) => setRol(e.target.value as RolValidat)}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
            >
              {ROLURI.map((r) => (
                <option key={r} value={r}>
                  {ETICHETE_ROL[r]}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            disabled={invitatie.isPending}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {invitatie.isPending ? 'Se trimite…' : 'Trimite invitația'}
          </button>
        </div>

        {invitatie.isSuccess && (
          <p className="mt-3 text-sm text-green-700">Invitația a plecat.</p>
        )}
      </form>

      {eroare && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{eroare.message}</p>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">Nume</th>
              <th className="px-4 py-3 font-medium">Rol</th>
              <th className="px-4 py-3 font-medium">Stare</th>
              <th className="px-4 py-3 font-medium">Creat</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {conturi.isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-neutral-500">
                  Se încarcă…
                </td>
              </tr>
            )}

            {conturi.data?.map((cont) => {
              const eEu = cont.id === utilizator.id
              return (
                <tr key={cont.id} className="border-b border-neutral-100 last:border-0">
                  <td className="px-4 py-3">
                    {cont.nume}
                    {eEu && <span className="ml-2 text-xs text-neutral-400">(tu)</span>}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={cont.rol}
                      disabled={eEu || schimbaRol.isPending}
                      onChange={(e) =>
                        schimbaRol.mutate({ id: cont.id, rol: e.target.value as RolValidat })
                      }
                      className="rounded-md border border-neutral-300 px-2 py-1 text-sm disabled:bg-neutral-50 disabled:text-neutral-400"
                    >
                      {ROLURI.map((r) => (
                        <option key={r} value={r}>
                          {ETICHETE_ROL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        cont.activ
                          ? 'rounded-full bg-green-50 px-2 py-1 text-xs text-green-700'
                          : 'rounded-full bg-neutral-100 px-2 py-1 text-xs text-neutral-500'
                      }
                    >
                      {cont.activ ? 'activ' : 'dezactivat'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-500">
                    {new Date(cont.creatLa).toLocaleDateString('ro-RO')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={eEu || comutaActiv.isPending}
                      onClick={() => comutaActiv.mutate({ id: cont.id, activ: cont.activ })}
                      className="rounded-md border border-neutral-300 px-3 py-1 text-xs disabled:opacity-40"
                    >
                      {cont.activ ? 'Dezactivează' : 'Reactivează'}
                    </button>
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
