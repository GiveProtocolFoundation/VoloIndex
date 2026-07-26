/**
 * Volo Index — Account / DSAR Routes (GIV-737 / GIV-743)
 *
 * Self-serve account management + internal DSAR execution.
 *
 * DELETE /api/account         — self-serve account erasure (user JWT)
 * GET    /api/account/export  — Art. 15/20 data portability (user JWT)
 * PATCH  /api/account         — rectification: display_name (user JWT)
 * POST   /api/internal/dsar/erase — DSAR execution (x-internal-key)
 */

import { Router } from 'express';
import { pool, query } from '../db.js';
import { eraseUser, exportUserData } from '../dsar.js';

// ── Self-serve routes (mounted under requireAuth) ───────────────────

export const accountRoutes = Router();

accountRoutes.delete('/', async (req, res, next) => {
  try {
    if (req.body.confirm !== true) {
      return res.status(400).json({
        error: { code: 'CONFIRMATION_REQUIRED', message: 'Send { confirm: true } to delete your account' },
      });
    }

    const result = await eraseUser(pool, req.user.id);

    // Revoke the calling auth session so the JWT can't be reused
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const { createHash } = await import('node:crypto');
      const tokenHash = createHash('sha256').update(authHeader.slice(7)).digest('hex');
      await query(
        'UPDATE auth_sessions SET revoked_at = NOW() WHERE token_hash = $1',
        [tokenHash],
      ).catch(() => { /* session may already be deleted by eraseUser */ });
    }

    res.json(result);
  } catch (err) { next(err); }
});

accountRoutes.get('/export', async (req, res, next) => {
  try {
    const data = await exportUserData(pool, req.user.id);
    res.setHeader('Content-Disposition', 'attachment; filename="voloindex-data-export.json"');
    res.json(data);
  } catch (err) { next(err); }
});

accountRoutes.patch('/', async (req, res, next) => {
  try {
    const { display_name } = req.body;
    if (display_name === undefined) {
      return res.status(400).json({
        error: { code: 'MISSING_FIELD', message: 'display_name is required' },
      });
    }

    if (display_name !== null && typeof display_name !== 'string') {
      return res.status(400).json({
        error: { code: 'INVALID_FIELD', message: 'display_name must be a string or null' },
      });
    }

    const sanitised = display_name === null ? null : display_name.replace(/[<>]/g, '').trim().slice(0, 200);

    const { rows: [updated] } = await query(
      `UPDATE users SET display_name = $2, updated_at = NOW()
       WHERE id = $1 AND erased_at IS NULL
       RETURNING id, email, display_name`,
      [req.user.id, sanitised],
    );

    if (!updated) {
      return res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: 'User not found or already erased' },
      });
    }

    res.json({ updated: true, display_name: updated.display_name });
  } catch (err) { next(err); }
});

// ── Internal DSAR execution (mounted under requireInternal) ─────────

export const dsarRoutes = Router();

dsarRoutes.post('/erase', async (req, res, next) => {
  try {
    const { email, userId } = req.body;
    if (!email && !userId) {
      return res.status(400).json({
        error: { code: 'MISSING_FIELD', message: 'Provide email or userId' },
      });
    }

    let targetUserId = userId;
    if (!targetUserId && email) {
      const { rows } = await query(
        'SELECT id FROM users WHERE email = $1',
        [email.toLowerCase().trim()],
      );
      if (rows.length === 0) {
        return res.status(404).json({
          error: { code: 'USER_NOT_FOUND', message: 'No user found with that email' },
        });
      }
      targetUserId = rows[0].id;
    }

    console.log(`[dsar] erasure requested for user ${targetUserId} (actor: internal)`);
    const result = await eraseUser(pool, targetUserId);
    console.log(`[dsar] erasure complete for user ${targetUserId}:`, result);

    res.json(result);
  } catch (err) { next(err); }
});
