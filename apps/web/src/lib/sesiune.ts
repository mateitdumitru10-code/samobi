import type { UtilizatorCurent } from '@samobi/shared/scheme'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { apel } from './api.js'
import { supabase } from './supabase.js'

/** True once Supabase has finished restoring a session from storage or from the URL. */
export function useSesiuneSupabase() {
  const [gata, setGata] = useState(false)
  const [areSesiune, setAreSesiune] = useState(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    let activ = true

    void supabase.auth.getSession().then(({ data }) => {
      if (!activ) return
      setAreSesiune(data.session !== null)
      setGata(true)
    })

    const { data: abonament } = supabase.auth.onAuthStateChange((_eveniment, sesiune) => {
      setAreSesiune(sesiune !== null)
      setGata(true)
      // The role may differ from what the cached profile says.
      void queryClient.invalidateQueries({ queryKey: ['eu'] })
    })

    return () => {
      activ = false
      abonament.subscription.unsubscribe()
    }
  }, [queryClient])

  return { gata, areSesiune }
}

/** The profile as the API sees it — the role here is the authoritative one. */
export function useUtilizator(activat: boolean) {
  return useQuery({
    queryKey: ['eu'],
    queryFn: () => apel<UtilizatorCurent>('/auth/eu'),
    enabled: activat,
    retry: false,
    staleTime: 60_000,
  })
}

export async function deconecteaza() {
  try {
    await apel('/auth/logout', { metoda: 'POST' })
  } catch {
    // Auditing a logout is best effort; the session still has to go.
  }
  await supabase.auth.signOut()
}
