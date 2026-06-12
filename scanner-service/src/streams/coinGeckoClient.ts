// ============================================================
// COINGECKO CLIENT
// Fetches price data for 300+ coins using CoinGecko's free API.
// Used as complement to Binance.us WebSocket streams.
// Free tier: 30 calls/min, no API key required.
// ============================================================

import { createLogger } from '../utils/constants';

const logger = createLogger('coingecko-client');
const BASE    = 'https://api.coingecko.com/api/v3';

// Map CoinGecko IDs to Binance symbols
const COINGECKO_IDS: Record<string, string> = {
  'bitcoin':          'BTCUSDT',  'ethereum':       'ETHUSDT',
  'binancecoin':      'BNBUSDT',  'solana':         'SOLUSDT',
  'ripple':           'XRPUSDT',  'cardano':        'ADAUSDT',
  'avalanche-2':      'AVAXUSDT', 'polkadot':       'DOTUSDT',
  'chainlink':        'LINKUSDT', 'uniswap':        'UNIUSDT',
  'cosmos':           'ATOMUSDT', 'litecoin':       'LTCUSDT',
  'ethereum-classic': 'ETCUSDT',  'stellar':        'XLMUSDT',
  'algorand':         'ALGOUSDT', 'tron':           'TRXUSDT',
  'near':             'NEARUSDT', 'dogecoin':       'DOGEUSDT',
  'shiba-inu':        'SHIBUSDT', 'aptos':          'APTUSDT',
  'arbitrum':         'ARBUSDT',  'optimism':       'OPUSDT',
  'injective-protocol':'INJUSDT', 'sui':            'SUIUSDT',
  'celestia':         'TIAUSDT',  'worldcoin-wld':  'WLDUSDT',
  'sei-network':      'SEIUSDT',  'fetch-ai':       'FETUSDT',
  'render-token':     'RENDERUSDT','internet-computer':'ICPUSDT',
  'hedera-hashgraph': 'HBARUSDT', 'vechain':        'VETUSDT',
  'filecoin':         'FILUSDT',  'aave':           'AAVEUSDT',
  'the-graph':        'GRTUSDT',  'sandbox':        'SANDUSDT',
  'decentraland':     'MANAUSDT', 'axie-infinity':  'AXSUSDT',
  'theta-token':      'THETAUSDT','elrond-erd-2':   'EGLDUSDT',
  'flow':             'FLOWUSDT', 'chiliz':         'CHZUSDT',
  'enjincoin':        'ENJUSDT',  'basic-attention-token':'BATUSDT',
  'compound-governance-token':'COMPUSDT','yearn-finance':'YFIUSDT',
  'maker':            'MKRUSDT',  'curve-dao-token':'CRVUSDT',
  'synthetix-network-token':'SNXUSDT','0x':         'ZRXUSDT',
  'loopring':         'LRCUSDT',  'balancer':       'BALUSDT',
  'sushiswap':        'SUSHIUSDT','1inch':          'ONEUSDT',
  'pancakeswap-token':'CAKEUSDT', 'terra-luna-2':   'LUNAUSDT',
  'frax-share':       'FXSUSDT',  'gmx':            'GMXUSDT',
  'blur':             'BLURUSDT', 'immutable-x':    'IMXUSDT',
  'starknet':         'STRKUSDT', 'pyth-network':   'PYTHUSDT',
  'jito-governance-token':'JITOUSDT','bonk':        'BONKUSDT',
  'dogwifcoin':       'WIFUSDT',  'pepe':           'PEPEUSDT',
  'floki':            'FLOKIUSDT','book-of-meme':   'BOMUSDT',
  'bitcoin-cash':     'BCHUSDT',  'monero':         'XMRUSDT',
  'dash':             'DASHUSDT', 'zcash':          'ZECUSDT',
  'iota':             'IOTAUSDT', 'neo':            'NEOUSDT',
  'ontology':         'ONTUSDT',  'qtum':           'QTUMUSDT',
  'icon':             'ICXUSDT',  'zilliqa':        'ZILUSDT',
  'waves':            'WAVESUSDT','band-protocol':  'BANDUSDT',
  'kava':             'KAVAUSDT', 'terra-luna':     'LUNCUSDT',
  'thorchain':        'RUNEUSDT', 'ocean-protocol': 'OCEANUSDT',
  'gala':             'GALAUSDT', 'stepn':          'GMTUSDT',
  'apecoin':          'APEUSDT',  'looksrare':      'LOOKSUSDT',
  'dydx':             'DYDXUSDT', 'mask-network':   'MASKUSDT',
  'ankr':             'ANKRUSDT', 'storj':          'STORJUSDT',
  'originprotocol':   'OGNUSDT',  'celo':           'CELOUSDT',
  'nervos-network':   'CKBUSDT',  'harmony':        'ONEUSDT',
};

const COINGECKO_ID_LIST = Object.keys(COINGECKO_IDS).join(',');

export interface CoinGeckoTicker {
  symbol:              string;
  price:               number;
  priceChangePercent24h: number;
  volume24h:           number;
  high24h:             number;
  low24h:              number;
  marketCap:           number;
  timestamp:           number;
}

let lastFetch    = 0;
let cachedTickers: CoinGeckoTicker[] = [];
const CACHE_TTL  = 60_000; // 1 min cache

export async function fetchCoinGeckoTickers(): Promise<CoinGeckoTicker[]> {
  const now = Date.now();
  if (now - lastFetch < CACHE_TTL && cachedTickers.length > 0) {
    return cachedTickers;
  }

  try {
    const url = `${BASE}/coins/markets?vs_currency=usd&ids=${COINGECKO_ID_LIST}&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      logger.error('CoinGecko API error', { status: res.status });
      return cachedTickers;
    }

    const data = await res.json() as any[];
    cachedTickers = data.map(coin => ({
      symbol:                COINGECKO_IDS[coin.id] ?? `${coin.symbol.toUpperCase()}USDT`,
      price:                 coin.current_price ?? 0,
      priceChangePercent24h: coin.price_change_percentage_24h ?? 0,
      volume24h:             coin.total_volume ?? 0,
      high24h:               coin.high_24h ?? 0,
      low24h:                coin.low_24h ?? 0,
      marketCap:             coin.market_cap ?? 0,
      timestamp:             now,
    }));

    lastFetch = now;
    logger.info('CoinGecko tickers fetched', { count: cachedTickers.length });
    return cachedTickers;
  } catch (err: any) {
    logger.error('CoinGecko fetch failed', { error: err.message });
    return cachedTickers;
  }
}
