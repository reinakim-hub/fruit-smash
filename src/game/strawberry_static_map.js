// Static strawberry pixel-art map for Fruit Smash.
// Original tile map data, designed to be imported by the Strawberry level.

export const STRAWBERRY_STATIC_ROWS = [
  '....................................',
  '........gg..........................',
  '........gg..........................',
  '........gg..........................',
  '.....g...gg.........................',
  '.....gg..Gg...g.....................',
  '......g..Gg..Gg...g.................',
  '...gG.GG.GgGGgG..gg.................',
  '....GGGGGddGGddggG.......g..........',
  '......ddddGdddGGG.....g.Gg....g.....',
  '....CRRRdGGDDddd.....GgGgg...gg...g.',
  '...RRRRRRGgDRDRGdd..GgGGgG..GgG..gg.',
  '...RRRPPRLgRRRRPRRL.GGGddGGGgG..ggG.',
  '..DDYRPPRPPPCPPPRPDRRRRRRddGgGGgG...',
  '.DRPRPRYPPYPCPPCPRDRRPPRRRPdGGGG....',
  '.RDDPRRDPPPCCCPCPDRPPPCPPPPLddG.....',
  '.DRRRRDPPRPPCPPPDRRPCPPPPPLLLLdGG...',
  '.DDRRDRRPRRRPPRDRRPCPCCCCCCCCLLdGggg',
  '.DRDRRDRYYRPRPPDRPPPCCCLLLLCCLLdGGg.',
  '..DRDDRRRDRRPYRRRPCPCCCLPPLCCLPRdGG.',
  '..DDDRDRRRRRRRRRPPPCCCLPPPLCCLPRddG.',
  '...DDDYRDRRDRDDPPPPCLPPPPLLCCPPRD...',
  '...DDRDDRDRRDRDPCCCLPPPLLLLCCCCRD...',
  '...DDDDRDRYRRDDPPCCPPPPLLCCCPCCRD...',
  '....DDDDDDDRDRDCCCLPPPLCCCCPPPPRD...',
  '....DDDDDDRRRDRPCCLPPLPCCCCCPPPRD...',
  '.....DDDYDRRDRPCLPPLCCCPPPCPPCRD....',
  '......DDDDRRDRPCPPLCCCPCPPPPRRRC....',
  '......DDRRYDDRPCLLCCPPPPCRPRRDD.....',
  '.......DDDRDRRPCCCCPCPCPPRRRDD......',
  '.......DDDRDDRRPPPPPRRRRDDD.........',
  '........DDDDC.RRRRRRRRRDDD..........',
  '...............DDDDDDDD.............',
  '....................................',
]

export const STRAWBERRY_STATIC_LEGEND = {
  '.': null,
  R: 'red',
  D: 'redDark',
  P: 'pink',
  L: 'palePink',
  C: 'cream',
  G: 'green',
  g: 'greenLight',
  d: 'greenDark',
  Y: 'seed',
}

export const STRAWBERRY_STATIC_PALETTE = {
  red: '#e80f1a',
  redDark: '#b8172b',
  pink: '#ed7892',
  palePink: '#f7c6d1',
  cream: '#ffe2d0',
  green: '#169c45',
  greenLight: '#58b83f',
  greenDark: '#08713f',
  seed: '#f5df25',
}

// Fruit-only grid, background cells left as null - the shared
// fillBreakableBackground/balanceLastBackgroundBand pipeline in level.js
// fills those with the strawberry's own themed gradient (see
// BREAKABLE_BG_PALETTES.strawberry in breakableYellowBackground.js), the
// same way every other map's background is built.
export function buildStrawberryStaticGrid() {
  return STRAWBERRY_STATIC_ROWS.map((row) => [...row].map((char) => STRAWBERRY_STATIC_LEGEND[char] ?? null))
}
