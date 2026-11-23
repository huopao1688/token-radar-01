# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/huopao1688/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/huopao1688/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. It reads a sealed DefiLlama snapshot of 758 protocols and ranks all 226 that record no token yet — the 40-protocol watchlist in full, plus every rankable pre-token protocol below its floor — by an implied launch value. The price is not a flat guess: each category is priced at its own traded protocols' median market-cap/TVL multiple from the same snapshot (winsorized, and shrunk toward the market-wide median in log space when a category's traded set is thin), then adjusted for the protocol's seven-day TVL growth and for how long it has run unissued. Every row carries a value band struck at its category's quartiles and a seven-step farm plan with costs and times. The dashboard is sortable and filterable, shows each protocol's price broken into its factors, keeps the traded protocols aside as the model's evidence, and includes a sandbox that re-ranks the board under your own growth and maturity constants.

Layout: `main.ts` is the program; `lib/model.ts` is the model (radar-2); `dashboard/` is the static page; `screenshots/` are real captures of it; `vendor/makefun-board.ts` is make.fun's dossier library, copied unchanged.

## Run it

```sh
# Node 22.18 or later, standard library only. The program reads /input/snapshot.json
# by default (as the grader mounts it); pass --input to point it at a local copy.
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=6ekd7qnk&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
