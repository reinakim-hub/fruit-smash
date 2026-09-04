"""Watermelon tile-grid map data - generated, hand-tunable.
40x40, max 7 playable colors, large simple clusters only."""

GRID_ROWS = 40
GRID_COLS = 40

WATERMELON_ROWS = [
    '........................................',
    '........................................',
    '........................................',
    '........................................',
    '........................................',
    '........................................',
    '........................................',
    '................C.......................',
    '.............CCCCCCC....................',
    '...........CCFFFFFFFCC..................',
    '..........DMCFFFFKKFFCC.................',
    '.........DDMMCFFFFFFFFCC................',
    '.........DDMMMCFFFFFFFFC................',
    '........DDDMMMMCFFFFFFFFC...............',
    '........DDDMMMMLCFFFFFFFC...............',
    '........DDDMMMMLLCFFFFFFC...............',
    '........DDDMMMMLLLCFFFFFC...............',
    '.......DDDDMMMMLLLMCFFFFFC..............',
    '........DDDMMMMLLLMMCFFFC...............',
    '........DDDMMMMLLLMMMCFFC...............',
    '........DDDMMMMLLLMMMMCFC...............',
    '........DDDMMMMLLLMMMMDCC.DD............',
    '.........DDMMMMLLLMMMMDD...D............',
    '.........DDMMMMLLLMMMMDD.....C..........',
    '..........DMMMMLLLMMMMD..CCCCCCCCC......',
    '...M.......MMMMLLLMMMM.CCPPFFFFFFFCC....',
    '...MM........MMLLLMM..CCPPPFFFFFFFFCC...',
    '....M...........L....CCPPPPFFFFFFKKFCC..',
    '.....................CFFFFFFFFFFFFFFFC..',
    '....................CFFFFKKFFFFFFFFFFFC.',
    '....................CKFFFFFFFFFFFFFFFFC.',
    '....................CFFFFFFFFFKKFFFFFFC.',
    '....................CFFFFFFFFFFFFFFFFFC.',
    '...................FFFFFFFFFFFFFFFFFFFFF',
    '........................................',
    '........................................',
    '........................................',
    '........................................',
    '........................................',
    '........................................',
]

WATERMELON_LEGEND = {
    '.': None,
    'D': 'rindDark',
    'M': 'rindMid',
    'L': 'rindLight',
    'C': 'rindCream',
    'F': 'flesh',
    'P': 'fleshPink',
    'K': 'seed',
}

WATERMELON_PALETTE = {
    'rindDark': '#1d6b35',
    'rindMid': '#3f9e4c',
    'rindLight': '#8ecf58',
    'rindCream': '#eef0a8',
    'flesh': '#ef4b46',
    'fleshPink': '#f9a8a8',
    'seed': '#241209',
}
