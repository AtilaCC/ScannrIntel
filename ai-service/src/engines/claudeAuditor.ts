// ============================================================
// CLAUDE AUDITOR ENGINE
// Final validation layer before approving any trade
// ============================================================

export interface AuditInput {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  consensusScore: number;
  riskScore: number;
  regime: string;
  macroFavorable: boolean;
  riskApproved: boolean;
  warnings: string[];
  kellySize: number;
}

export interface AuditResult {
  approved: boolean;
  finalAction: 'BUY' | 'SELL' | 'HOLD';
  invalidationFactors: string[];
  auditScore: number;
  auditNotes: string[];
  overrideReason?: string;
}

export function runClaudeAuditor(input: AuditInput): AuditResult {
  const invalidationFactors: string[] = [];
  const auditNotes: string[] = [];
  let auditScore = 100;
  let approved = true;
  let finalAction = input.action;
  let overrideReason: string | undefined;

  // Rule 1: Never trade with very low confidence
  if (input.confidence < 35) {
    invalidationFactors.push('Confidence below minimum threshold (35%)');
    auditScore -= 40;
    approved = false;
  }

  // Rule 2: Never trade against strong regime
  if (input.regime === 'BEAR' && input.action === 'BUY' && input.confidence < 70) {
    invalidationFactors.push('Buying in bear market without strong conviction');
    auditScore -= 25;
    finalAction = 'HOLD';
    overrideReason = 'Bear regime override — action changed to HOLD';
  }

  if (input.regime === 'BULL' && input.action === 'SELL' && input.confidence < 70) {
    invalidationFactors.push('Selling in bull market without strong conviction');
    auditScore -= 20;
  }

  // Rule 3: Risk engine veto
  if (!input.riskApproved) {
    invalidationFactors.push('Risk engine rejected trade');
    auditScore -= 35;
    approved = false;
  }

  // Rule 4: Macro conflict
  if (!input.macroFavorable && input.action !== 'HOLD') {
    invalidationFactors.push('Macro conditions unfavorable');
    auditScore -= 15;
    auditNotes.push('Consider reducing position size due to macro headwinds');
  }

  // Rule 5: Too many warnings
  if (input.warnings.length >= 4) {
    invalidationFactors.push(`Multiple risk warnings present (${input.warnings.length})`);
    auditScore -= 20;
  }

  // Rule 6: Negative consensus
  if (input.consensusScore < -30 && input.action === 'BUY') {
    invalidationFactors.push('Strong bearish consensus contradicts BUY signal');
    auditScore -= 30;
    approved = false;
  }

  // Rule 7: Kelly too small — not worth trading
  if (input.kellySize < 2) {
    invalidationFactors.push('Kelly position size too small to be meaningful');
    auditScore -= 10;
    finalAction = 'HOLD';
    overrideReason = 'Position size insufficient — changed to HOLD';
  }

  auditScore = Math.max(0, auditScore);

  if (auditScore < 50) {
    approved = false;
    finalAction = 'HOLD';
    if (!overrideReason) overrideReason = 'Audit score too low — trade rejected';
  }

  if (invalidationFactors.length === 0) {
    auditNotes.push('All audit checks passed — trade approved');
  }

  return {
    approved,
    finalAction: finalAction as 'BUY' | 'SELL' | 'HOLD',
    invalidationFactors,
    auditScore,
    auditNotes,
    overrideReason,
  };
}
