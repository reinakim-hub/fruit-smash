// Static watermelon pixel-art map for Fruit Smash.
// 34 rows x 36 columns - designed directly for the game grid: whole melon
// in back, front slice, stem. Every playable color count is already an
// exact multiple of ten, so the shared queue step needs no rounding.

export const WATERMELON_STATIC_ROWS = [
  '....................................',
  '....................................',
  '................BBC.................',
  '...............BBBB.................',
  '...............BBL..................',
  '..........LMMMDBBDDMM...............',
  '........LDMLLMMKKMMLMDM.............',
  '.......MDMLMMMLMMLMMLMDD............',
  '......MDLLLMMLLMMLLMMLLDD...........',
  '.....LDLCLMMLLLMMLLMMMLMDM..........',
  '.....DLCCLMMLLMMMLLLMMMLDDL.........',
  '....DMLCLMMLLLMMMMLLMMMLMDD.........',
  '....DLCLMMMLLLMMMLLLMMMMLDDM........',
  '...DDLLLMMMLLMMMMMLLMMDMLMDD........',
  '...DMLLMMMLLLMMMMMCCCDDMCMDD........',
  '...DMLLMMMLLLMMMMMLLMDDDLMDDM.......',
  '...DMLLMMMLLLMMMMDMLMDDMLMDDM..RLL..',
  '...DMLLMMMLLLMMDDMLLMDDRMRKRKRRKCM..',
  '...DMLLDDDMLMDDDDMMRKKRRRPPRRRRRCM..',
  '...DMLMDDDMMMKKBRRRPPRRRRKRRRRRRCM..',
  '...DDMLMDDLPRPPPRRRRRRRRRRRRBKRRCM..',
  '...LDMLMDDCCRRRRKRRRRRRRRRRRRRRPCM..',
  '....DDMMDMLCPRRBRRRRKRRRRRBBRRRKLL..',
  '....LDDMDMMCCRRRRRBRRRRRKRRRRRRCLL..',
  '.....DDDDDMLCPRRRRRRRBRRKRRBKRPCM...',
  '...LMMMLDDMMCCRKRRRRRRRRRRRBRPCLM...',
  '....LMMMMDMMLCCRRBRKRRRRRRRRPCCM....',
  '...LMMMMMDDMDLCCPRRRRRRKRRRPCCML....',
  '..LLMMMMMMDDMDLCCCPPRRRRPPCCCML.....',
  '..MMMMMLLMLLDMDMLCCCCCCCCCCLDL......',
  '..LMM.LLMM...LDDDMLLLLLLLMMM........',
  '.....M.MM......LLLDDDDDDML..........',
  '....................................',
  '....................................',
]

export const WATERMELON_STATIC_LEGEND = {
  '.': null,
  D: 'melonDark',
  M: 'melonMid',
  L: 'melonLight',
  R: 'fleshRed',
  P: 'fleshPink',
  C: 'rindCream',
  K: 'seedDark',
  B: 'stemBrown',
}

export const WATERMELON_STATIC_PALETTE = {
  melonDark: '#144A2A',
  melonMid: '#337A38',
  melonLight: '#8FD34F',
  fleshRed: '#ED4651',
  fleshPink: '#F67D82',
  rindCream: '#E8D695',
  seedDark: '#4A241A',
  stemBrown: '#8A4B25',
}

// Documents the same invariant the queue-balancing pipeline in level.js
// depends on - every color's total tile count here is already an exact
// multiple of ten, so buildQueue can always split it into clean 10/20/30
// ammo chunks with nothing left over.
export const WATERMELON_STATIC_COUNTS = {
  melonDark: 100,
  melonMid: 200,
  melonLight: 140,
  fleshRed: 140,
  fleshPink: 20,
  rindCream: 50,
  seedDark: 20,
  stemBrown: 20,
}

export function buildWatermelonStaticGrid() {
  return WATERMELON_STATIC_ROWS.map((row) => [...row].map((char) => WATERMELON_STATIC_LEGEND[char] ?? null))
}
