// ============================================================
// GOPLUS SECURITY INTEGRATION
// Analyzes smart contract vulnerabilities via GoPlus API.
// Free tier available — no API key required for basic checks.
// ============================================================

import { createLogger } from '../utils/shared';

const logger = createLogger('goplus-security');
const BASE_URL = 'https://api.gopluslabs.io/api/v1';

export interface ContractRisk {
  address:        string;
  chainId:        string;
  isHoneypot:     boolean;
  isMintable:     boolean;
  isProxy:        boolean;
  isBlacklisted:  boolean;
  buyTax:         number;
  sellTax:        number;
  holderCount:    number;
  top10HoldersRatio: number;
  risks:          string[];
  riskScore:      number; // 0-100
  riskLevel:      'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

// Known token contract addresses for major coins
const KNOWN_CONTRACTS: Record<string, { address: string; chainId: string }> = {
  'BTCUSDT':  { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', chainId: '1' }, // WBTC on ETH
  'ETHUSDT':  { address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', chainId: '1' },
  'BNBUSDT':  { address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', chainId: '56' },
  'SOLUSDT':  { address: '0xD31a59c85aE9D8edEFeC411D448f90841571b89c', chainId: '1' },
};

export async function analyzeContract(address: string, chainId: string = '1'): Promise<ContractRisk | null> {
  try {
    const res = await fetch(`${BASE_URL}/token_security/${chainId}?contract_addresses=${address}`);
    if (!res.ok) {
      logger.error('GoPlus API error', { status: res.status });
      return null;
    }

    const data = await res.json() as any;
    const token = data.result?.[address.toLowerCase()];
    if (!token) return null;

    const risks: string[] = [];
    if (token.is_honeypot === '1')      risks.push('Honeypot detectado');
    if (token.is_mintable === '1')      risks.push('Token mintável');
    if (token.is_proxy === '1')         risks.push('Contrato proxy');
    if (token.is_blacklisted === '1')   risks.push('Endereço na blacklist');
    if (parseFloat(token.buy_tax)  > 10) risks.push(`Taxa de compra alta: ${token.buy_tax}%`);
    if (parseFloat(token.sell_tax) > 10) risks.push(`Taxa de venda alta: ${token.sell_tax}%`);

    const top10 = parseFloat(token.holder_count > 0 ? token.top10_holder_ratio ?? '0' : '0');
    if (top10 > 0.8) risks.push(`Top 10 detentores com ${(top10 * 100).toFixed(1)}% do supply`);

    const riskScore = Math.min(100, risks.length * 20 + (token.is_honeypot === '1' ? 60 : 0));
    const riskLevel = riskScore >= 80 ? 'CRITICAL' : riskScore >= 60 ? 'HIGH' : riskScore >= 40 ? 'MEDIUM' : riskScore >= 20 ? 'LOW' : 'SAFE';

    return {
      address,
      chainId,
      isHoneypot:         token.is_honeypot === '1',
      isMintable:         token.is_mintable === '1',
      isProxy:            token.is_proxy === '1',
      isBlacklisted:      token.is_blacklisted === '1',
      buyTax:             parseFloat(token.buy_tax ?? '0'),
      sellTax:            parseFloat(token.sell_tax ?? '0'),
      holderCount:        parseInt(token.holder_count ?? '0'),
      top10HoldersRatio:  top10,
      risks,
      riskScore,
      riskLevel,
    };
  } catch (err: any) {
    logger.error('GoPlus analysis failed', { error: err.message, address });
    return null;
  }
}

export async function analyzeTokenSymbol(symbol: string): Promise<ContractRisk | null> {
  const known = KNOWN_CONTRACTS[symbol];
  if (!known) {
    logger.warn('No contract address known for symbol', { symbol });
    return null;
  }
  return analyzeContract(known.address, known.chainId);
}
