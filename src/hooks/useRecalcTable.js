import { collection, getDocs, doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'

export function useRecalcTable() {
  const recalc = async (leagueId) => {
    const [fixSnap, teamSnap] = await Promise.all([
      getDocs(collection(db, 'leagues', leagueId, 'fixtures')),
      getDocs(collection(db, 'leagues', leagueId, 'teams')),
    ])

    const zero = () => ({ p:0, w:0, l:0, pts:0, setsWon:0, setsLost:0, ptsFor:0, ptsAgainst:0 })
    const statsMap = {}
    teamSnap.docs.forEach(d => { statsMap[d.id] = {} })

    fixSnap.docs.forEach(d => {
      const f = d.data()
      if (f.status !== 'completed') return
      const homeId = f.homeTeam?.id
      const awayId = f.awayTeam?.id
      const ev     = f.event
      if (!homeId || !awayId || !ev) return

      if (!statsMap[homeId]) statsMap[homeId] = {}
      if (!statsMap[awayId]) statsMap[awayId] = {}
      if (!statsMap[homeId][ev]) statsMap[homeId][ev] = zero()
      if (!statsMap[awayId][ev]) statsMap[awayId][ev] = zero()

      const allSets   = f.sets || []
      const wonSets   = allSets.filter(s => s.winner)
      const sH        = wonSets.filter(s => s.winner === 'home').length
      const sA        = wonSets.filter(s => s.winner === 'away').length
      const homeWon   = sH > sA
      const totalHome = allSets.reduce((sum, s) => sum + (s.home || 0), 0)
      const totalAway = allSets.reduce((sum, s) => sum + (s.away || 0), 0)

      const addTo = (id, won, sw, sl, pf, pa) => {
        statsMap[id][ev].p++
        statsMap[id][ev].w          += won ? 1 : 0
        statsMap[id][ev].l          += won ? 0 : 1
        statsMap[id][ev].pts        += won ? 2 : 0
        statsMap[id][ev].setsWon    += sw
        statsMap[id][ev].setsLost   += sl
        statsMap[id][ev].ptsFor     += pf
        statsMap[id][ev].ptsAgainst += pa
      }
      addTo(homeId,  homeWon,  sH, sA, totalHome, totalAway)
      addTo(awayId, !homeWon, sA, sH, totalAway, totalHome)
    })

    await Promise.all(
      Object.entries(statsMap).map(([teamId, evStats]) => {
        const upd = {}
        Object.entries(evStats).forEach(([ev, s]) => {
          upd[`eventStats.${ev}.p`]           = s.p
          upd[`eventStats.${ev}.w`]           = s.w
          upd[`eventStats.${ev}.l`]           = s.l
          upd[`eventStats.${ev}.pts`]         = s.pts
          upd[`eventStats.${ev}.setsWon`]     = s.setsWon
          upd[`eventStats.${ev}.setsLost`]    = s.setsLost
          upd[`eventStats.${ev}.ptsFor`]      = s.ptsFor
          upd[`eventStats.${ev}.ptsAgainst`]  = s.ptsAgainst
        })
        return updateDoc(doc(db, 'leagues', leagueId, 'teams', teamId), upd)
      })
    )
  }

  return { recalc }
}
