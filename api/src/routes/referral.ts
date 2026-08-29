/**
 * Referral API route skeleton
 *
 * TODO: wire this into the API server, add input validation, auth, and contract calls.
 */
import { Router, Request, Response } from 'express';

const router = Router();

router.post('/referral', async (req: Request, res: Response) => {
  // TODO: validate `req.body`, authenticate caller, and forward to on-chain contract
  res.status(501).json({ error: 'Not implemented' });
});

export default router;
