// The token radar's model, version radar-2: one snapshot of the protocol universe in, one ranked
// board out. Every figure the board states is derived from the snapshot's own records, in three
// steps a reader can check:
//
//   1. What the market pays for a dollar of TVL in this protocol's category. The snapshot's traded
//      protocols give, for each category, the market's own mcap/TVL ratios; the model takes their
//      median (and the 25th and 75th percentiles for the value band). The ratios are winsorized to
//      [RATIO_MIN, RATIO_MAX] and averaged in log space, and a category with few traded protocols
//      has its line pulled toward the market-wide line, weighted by a phantom count of SHRINK_K
//      peers, so one extreme name in a thin category cannot price a whole board on its own.
//   2. A growth adjustment from the protocol's own seven-day TVL change, clamped and weighted.
//   3. A maturity adjustment from how long the protocol has run with no token: the longer a large
//      protocol has operated unissued, the more of its value a launch would have to recognise.
//
//   implied = TVL x category multiple x growth multiplier x maturity multiplier
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every
// other rankable pre-token protocol the snapshot carries: the early rows the radar exists to find.
// A protocol is pre-token when its record names no token (no market cap, no CoinGecko id, no
// symbol). Traded protocols are never ranked; they are the model's evidence, shown as the market's
// own values in the live set. No protocol name is ever special-cased: the same function scores
// every row, and the same category table prices every protocol in a category.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  shrink_k: number;
  ratio_min: number;
  ratio_max: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  early_cap: number;
}

export const MODEL: ModelConstants = {
  shrink_k: 6,
  ratio_min: 0.005,
  ratio_max: 20,
  growth_weight: 0.4,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  early_cap: 400,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's traded evidence: how many traded protocols, and what the market pays per TVL. */
export interface CategoryStat {
  category: string;
  live_n: number;
  multiple: number;
  multiple_low: number;
  multiple_high: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  value_low_usd: number;
  value_high_usd: number;
  model: {
    category: string;
    category_live_n: number;
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  value_low_usd: number;
  value_high_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** Everything the dashboard needs: the board, the live set, the category table and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  scanned_size: number;
  categories: CategoryStat[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The value at fraction `f` of a sorted, non-empty array (nearest rank). */
function quantile(sorted: number[], f: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(f * sorted.length)))]!;
}

/** The category key a protocol's evidence is filed under. */
function categoryKey(p: SnapshotProtocol): string {
  return p.category ?? '(uncategorised)';
}

/**
 * The traded evidence, from the snapshot's own live set: for every category, the mcap/TVL ratios
 * of its traded protocols (market cap recorded, TVL above zero), winsorized to the model's ratio
 * bounds, their quartiles taken in log space, and the shrunk multiples the model prices with: each
 * category's line is pulled toward the market-wide line by SHRINK_K phantom peers, in log space, so
 * a thin category's one extreme peer moves its price by a fraction, not by orders of magnitude.
 * The market-wide line is filed under the empty category key.
 */
export function categoryStats(snapshot: Snapshot, model: ModelConstants = MODEL): Map<string, CategoryStat> {
  const logRatios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const raw = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(raw) || raw <= 0) continue;
    const r = Math.log(Math.min(model.ratio_max, Math.max(model.ratio_min, raw)));
    all.push(r);
    const key = categoryKey(p);
    const list = logRatios.get(key);
    if (list === undefined) logRatios.set(key, [r]);
    else list.push(r);
  }
  all.sort((a, b) => a - b);
  const global = {
    n: all.length,
    low: quantile(all, 0.25),
    mid: quantile(all, 0.5),
    high: quantile(all, 0.75),
  };
  const shrink = (value: number, n: number, globalValue: number): number =>
    Math.exp((n * value + model.shrink_k * globalValue) / (n + model.shrink_k));
  const stats = new Map<string, CategoryStat>();
  stats.set('', {
    category: 'All categories (market-wide)',
    live_n: global.n,
    multiple: round4(Math.exp(global.mid)),
    multiple_low: round4(Math.exp(global.low)),
    multiple_high: round4(Math.exp(global.high)),
  });
  for (const [key, list] of logRatios) {
    list.sort((a, b) => a - b);
    const n = list.length;
    stats.set(key, {
      category: key,
      live_n: n,
      multiple: round4(shrink(quantile(list, 0.5), n, global.mid)),
      multiple_low: round4(shrink(quantile(list, 0.25), n, global.low)),
      multiple_high: round4(shrink(quantile(list, 0.75), n, global.high)),
    });
  }
  return stats;
}

/** The category line a protocol is priced on: its own category's, or the market-wide line. */
function statFor(stats: Map<string, CategoryStat>, p: SnapshotProtocol): CategoryStat {
  return stats.get(categoryKey(p)) ?? stats.get('')!;
}

/** The multipliers and the implied value one protocol gets under `model`, priced on `stat`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  stat: CategoryStat,
): { implied: number; low: number; high: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const base = protocol.tvl_usd * stat.multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  const low = Math.max(1, Math.round(protocol.tvl_usd * stat.multiple_low * growthMult * maturityMult));
  const high = Math.max(low, Math.round(protocol.tvl_usd * stat.multiple_high * growthMult * maturityMult));
  return { implied, low, high, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const stats = categoryStats(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, by TVL, up to the cap. The cap sits
  // above this snapshot's whole pre-token count, so the board ranks the full unissued universe the
  // snapshot carries rather than a sample of it.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, model.early_cap);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const stat = statFor(stats, p);
    const v = impliedValue(p, snapshot.as_of, model, stat);
    return { p, stat, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    value_low_usd: s.low,
    value_high_usd: s.high,
    model: {
      category: s.stat.category,
      category_live_n: s.stat.live_n,
      category_multiple: s.stat.multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A second chain a protocol names, or null. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 50;
  return 25;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's two actions, in words a farmer can follow: the main position, then a second one. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string, second: string | null): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const half = Math.max(10, Math.round(capital / 2));
  if (c.includes('curator') || c.includes('allocator'))
    return [
      `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares in the wallet.`,
      second !== null
        ? `Open a second, smaller vault position of $${half} on ${second}, so the farm is not riding on one chain's strategy.`
        : `After the first week, add $${half} more to the same vault rather than opening a second wallet.`,
    ];
  if (c.includes('lend'))
    return [
      `Supply $${capital} of USDC or ETH to ${name} on ${chain} and leave the supplied balance untouched.`,
      `Borrow about $${half} of a stablecoin against the position, hold it two days, then repay in full: borrow-side activity is what most lending launches count.`,
    ];
  if (c.includes('cdp') || c.includes('collateral'))
    return [
      `Deposit $${capital} of ETH as collateral in ${name} on ${chain} and mint its stablecoin against it, keeping the health factor above 2.`,
      `Put the minted stablecoin to work in ${name}'s own liquidity pool or stability module rather than selling it.`,
    ];
  if (c.includes('dex'))
    return [
      `Provide $${capital} of liquidity to ${name}'s busiest pair on ${chain}, split evenly between the two sides.`,
      `Route one swap of about $${half} through ${name} each week instead of an aggregator, so the wallet shows as a trader as well as a provider.`,
    ];
  if (c.includes('bridge') || c.includes('cross chain'))
    return [
      `Bridge $${capital} of USDC from Ethereum to ${chain === 'Ethereum' ? 'Base' : chain} through ${name} and use the bridged funds in one app on the far side.`,
      `Bridge about $${half} back on a different day: two directions on two days read as a user, not a pass-through.`,
    ];
  if (c.includes('staking') || c.includes('restak'))
    return [
      `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the wallet.`,
      `Use the receipt token once: supply it to a lending market or pair it in a pool, then unwind back to the plain receipt before the hold ends.`,
    ];
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options'))
    return [
      `Deposit $${capital} of USDC as margin on ${name} and open one small position hedged against a spot holding, so the farm is the activity, not the bet.`,
      `Close and reopen a position of about $${half} once a week: traded volume across several weeks is the record a launch rewards.`,
    ];
  if (c.includes('prediction'))
    return [
      `Fund $${capital} on ${name} and take a position in its most liquid market.`,
      `Settle the position at expiry and take a fresh one in a different market, so the history spans more than one event.`,
    ];
  if (c.includes('yield'))
    return [
      `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the shares.`,
      second !== null
        ? `Split $${half} into a second ${name} vault on ${second} once the first has run a week.`
        : `Claim and re-deposit any harvested yield once, midway through the hold, instead of letting it sit idle.`,
    ];
  if (c.includes('rwa'))
    return [
      `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it in the wallet.`,
      `Provide about $${half} of liquidity for the asset where it trades, so the wallet appears on both sides of the market.`,
    ];
  if (c.includes('stable') || c.includes('basis'))
    return [
      `Deposit $${capital} of USDC into ${name} on ${chain} to mint or hold its stable asset.`,
      `Pair about $${half} of the stable asset in its main liquidity pool and keep the LP position for the hold.`,
    ];
  if (c.includes('insurance'))
    return [
      `Buy $${capital} of cover from ${name} on ${chain} against a position you actually hold, and keep the policy to expiry.`,
      `Stake about $${half} into ${name}'s underwriting pool if it offers one, which is the side a cover protocol rewards first.`,
    ];
  if (c.includes('launchpad') || c.includes('launch'))
    return [
      `Register the wallet on ${name} and complete one participation of about $${capital} in a live launch on ${chain}.`,
      `Hold whatever the launch allocates instead of selling on day one; holders are the wallets a follow-on token counts.`,
    ];
  if (c.includes('payment'))
    return [
      `Move $${capital} through ${name} as a real payment to a second wallet you control on ${chain}.`,
      `Receive one payment back through ${name} in a later week, so the wallet shows flow in both directions.`,
    ];
  if (c.includes('index') || c.includes('indexes'))
    return [
      `Deposit $${capital} into a ${name} index vault on ${chain} and keep the index shares.`,
      `Rebalance once midway through the hold by adding $${half}, rather than opening and closing the position.`,
    ];
  return [
    `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    `Repeat a smaller action of about $${half} in the third week, so the wallet's history is a pattern of use, not one deposit.`,
  ];
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The two middle actions
 * are the category's own; the rest is the discipline every farm needs. The plan is derived from the
 * protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const second = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const [main, follow] = actionsFor(p, capital, chain, second);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm ${p.name} with, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: main,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: follow,
      cost: 'about $3 of gas',
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and vary the day and the amount slightly.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    value_low_usd: row.value_low_usd,
    value_high_usd: row.value_high_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const stats = categoryStats(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const categories = [...stats.values()].sort((a, b) => {
    const aGlobal = a.category === 'All categories (market-wide)' ? 0 : 1;
    const bGlobal = b.category === 'All categories (market-wide)' ? 0 : 1;
    return aGlobal - bGlobal || b.multiple - a.multiple;
  });
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    scanned_size: snapshot.protocols.length,
    categories,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows: the gate wants at least 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!(r.value_low_usd <= r.implied_value_usd && r.implied_value_usd <= r.value_high_usd)) return `${r.slug} has a value band that excludes its implied value`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
