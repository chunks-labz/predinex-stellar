import { Request, Response, Router } from 'express';
import { body, validationResult } from 'express-validator';
import { BigInt } from 'big-integer';
import { BudgetOptimizationResult } from '../../types';

const router = Router();

/**
 * Budget optimization endpoint
 */
router.post('/optimize-fees', [
  body('currentFeeBps')
    .isInt({ min: 0, max: 10000 })
    .withMessage('Current fee must be 0-10000 bps'),
  body('avgPoolSize').isInt({ min: 0 }).withMessage('Pool size must be positive'),
  body('competitorFees').isArray().withMessage('Competitor fees must be an array'),
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const request = req.body;
    const competitorFees = request.competitorFees || [];
    const marketAvg = competitorFees.length > 0
      ? competitorFees.reduce((sum, fee) => sum + fee, 0) / competitorFees.length
      : 0;

    const recommendedFee = marketAvg > 0 ? Math.round(marketAvg) : 50;

    // Guard against division by zero
    const feeChangePct = request.currentFeeBps > 0
      ? ((recommendedFee - request.currentFeeBps) / request.currentFeeBps) * 100
      : 0;

    const volumeImpactPct = feeChangePct * -2;
    const clampedVolumeImpact = Math.max(-99, Math.min(99, volumeImpactPct));

    const newVolume = (BigInt(request.avgPoolSize) * BigInt(100 + Math.floor(clampedVolumeImpact))) / BigInt(100);

    const competitiveness = marketAvg > 0
      ? (request.currentFeeBps - marketAvg) / marketAvg
      : 0;

    const result: BudgetOptimizationResult = {
      recommendedFee,
      feeChangePct,
      volumeImpactPct: clampedVolumeImpact,
      newVolume: newVolume.toString(),
      competitiveness,
      status: 'success'
    };

    res.json(result);
  } catch (error) {
    console.error('Budget optimization error:', error);
    res.status(500).json({ error: 'Failed to optimize fees' });
  }
});

export default router;