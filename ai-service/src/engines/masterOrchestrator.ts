// ============================================================
// MASTER ORCHESTRATOR
// Runs all engines in sequence and produces final output
// ============================================================

import { runMultiModelEngine, MarketData } from './multiModelEngine';
import { runVotingEngine } from './votingEngine';
import { runConfidenceEngine, MarketContext } from './confidenceEngine';
import { detectRegime } from './regimeEngine';
import { runCorrelationEngine } from './correlationEngine';
import { runKellyEngine } from './kellyEngine';
import { runRiskEngine } from './riskEngine';
import { runStatArbEngine } from './statArbEngine';
import { runMacroEngine, MacroData } from './macroEngine';
import { runSocialEngine, SocialSignal } from './socialEngine';
import { runClaudeAuditor } from './claudeAuditor';
import { runPortfolioEngine, Position } from './portfolioEngine';

export interface OrchestratorInput {
  marketData: MarketData;
  btcPrices: number[];
  macroData?: MacroData;
  socialSignals?: SocialSignal[];
  positions?: Position[];
}

export interface OrchestratorOutput {
  symbol: string;
  timestamp: Date;
  action: 'BUY' | 'SELL' | 'HOLD';
  classification: 'OPPORTUNITY' | 'RISK_EVENT' | 'NOISE';
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  entryType: 'EARLY' | 'CONFIRMATION' | 'LATE';
  confidence: number;
  consensusScore: number;
  riskScore: number;
  opportunityScore: number;
  riskRewardRatio: number;
  kellyFraction: number;
  positionSizePercent: number;
  stopLoss: number;
  takeProfit: number;
  regime: string;
  macroRegime: string;
  approved: boolean;
  keyDrivers: string[];
  invalidationFactors: string[];
  warnings: string[];
  isEarlySignal: boolean;
  maturityLevel: number;
  engineResults: {
    models: number;
    bullishVotes: number;
    bearishVotes: number;
    neutralVotes: number;
    statArb: boolean;
    correlation: string;
    portfolioScore: number;
  };
}

export async function runMasterOrchestrator(input: OrchestratorInput): Promise<OrchestratorOutput> {
  const { marketData, btcPrices, macroData, socialSignals = [], positions = [] } = input;

  // 1. Multi-Model Engine
  const models = runMultiModelEngine(marketData);

  // 2. Voting Engine
  const voting = runVotingEngine(models);

  // 3. Regime Detection
  const regime = detectRegime(marketData.prices, marketData.volumes);

  // 4. Correlation Engine
  const correlation = runCorrelationEngine(marketData.prices, btcPrices, marketData.symbol);

  // 5. Statistical Arbitrage
  const statArb = runStatArbEngine(marketData.prices, btcPrices, marketData.symbol);

  // 6. Macro Engine
  const macro = macroData ? runMacroEngine(macroData) : { regime: 'NEUTRAL', cryptoFavorable: true, score: 50, signals: [], warnings: [], liquidityCondition: 'NEUTRAL' as const };

  // 7. Social Engine
  const social = runSocialEngine(socialSignals);

  // 8. Confidence Engine
  const atrPercent = marketData.high.length > 0
    ? ((Math.max(...marketData.high.slice(-14)) - Math.min(...marketData.low.slice(-14))) / marketData.close[marketData.close.length - 1]) * 100
    : 3;

  const volModel = models.find(m => m.name === 'VOLUME_SPIKE');
  const relVol = volModel ? volModel.value : 1;

  const context: MarketContext = {
    volumeSpike: relVol > 2,
    relativeVolume: relVol,
    atrPercent,
    macroAligned: macro.cryptoFavorable,
    onChainAligned: true,
    derivativesAligned: true,
  };

  const confidence = runConfidenceEngine(voting, context);

  // 9. Determine action
  const rawAction: 'BUY' | 'SELL' | 'HOLD' =
    voting.consensus === 'STRONG_BULLISH' || voting.consensus === 'BULLISH' ? 'BUY' :
    voting.consensus === 'STRONG_BEARISH' || voting.consensus === 'BEARISH' ? 'SELL' : 'HOLD';

  // 10. Kelly Engine
  const kelly = runKellyEngine(confidence.score, 2.5, 0.55);

  // 11. Risk Engine
  const currentPrice = marketData.prices[marketData.prices.length - 1];
  const risk = runRiskEngine(currentPrice, atrPercent, confidence.score, regime.regime, rawAction);

  // 12. Portfolio Engine
  const portfolio = runPortfolioEngine(positions, kelly.positionSizePercent);

  // 13. Claude Auditor — final gate
  const audit = runClaudeAuditor({
    symbol: marketData.symbol,
    action: rawAction,
    confidence: confidence.score,
    consensusScore: voting.consensusScore,
    riskScore: risk.riskScore,
    regime: regime.regime,
    macroFavorable: macro.cryptoFavorable,
    riskApproved: risk.approved,
    warnings: [...risk.warnings, ...macro.warnings, ...social.warnings],
    kellySize: kelly.positionSizePercent,
  });

  // 14. Classify signal
  const classification: OrchestratorOutput['classification'] =
    confidence.score < 40 ? 'NOISE' :
    risk.riskScore > 70 ? 'RISK_EVENT' : 'OPPORTUNITY';

  const entryType: OrchestratorOutput['entryType'] =
    statArb.opportunity ? 'EARLY' :
    voting.consensus === 'STRONG_BULLISH' || voting.consensus === 'STRONG_BEARISH' ? 'CONFIRMATION' : 'LATE';

  const keyDrivers = [
    ...models.filter(m => m.vote !== 'NEUTRAL').slice(0, 3).map(m => m.signal),
    ...macro.signals.slice(0, 2),
    ...(statArb.opportunity ? [statArb.description] : []),
    ...(correlation.divergence ? [correlation.signal] : []),
  ].slice(0, 6);

  return {
    symbol: marketData.symbol,
    timestamp: new Date(),
    action: audit.finalAction,
    classification,
    sentiment: voting.dominantVote === 'BULLISH' ? 'BULLISH' : voting.dominantVote === 'BEARISH' ? 'BEARISH' : 'NEUTRAL',
    entryType,
    confidence: confidence.score,
    consensusScore: voting.consensusScore,
    riskScore: risk.riskScore,
    opportunityScore: Math.max(0, 100 - risk.riskScore),
    riskRewardRatio: risk.riskRewardRatio,
    kellyFraction: kelly.fractionalKelly,
    positionSizePercent: Math.min(kelly.positionSizePercent, portfolio.maxNewPositionSize),
    stopLoss: risk.stopLoss,
    takeProfit: risk.takeProfit,
    regime: regime.regime,
    macroRegime: macro.regime,
    approved: audit.approved,
    keyDrivers,
    invalidationFactors: audit.invalidationFactors,
    warnings: [...risk.warnings, ...macro.warnings],
    isEarlySignal: entryType === 'EARLY',
    maturityLevel: 6,
    engineResults: {
      models: models.length,
      bullishVotes: voting.bullishVotes,
      bearishVotes: voting.bearishVotes,
      neutralVotes: voting.neutralVotes,
      statArb: statArb.opportunity,
      correlation: correlation.signal,
      portfolioScore: portfolio.portfolioScore,
    },
  };
}
