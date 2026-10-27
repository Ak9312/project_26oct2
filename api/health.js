// GET /api/health — says which settings are present (never their values).
// APP_PASSWORD is optional, so it is reported separately and never counts
// as missing.
import { send, MOCK } from './_lib.js';

export default function handler(req, res) {
  send(res, 200, {
    ok: true,
    mock: MOCK,
    password_required: Boolean(process.env.APP_PASSWORD),
    configured: {
      N8N_BASE_URL: Boolean(process.env.N8N_BASE_URL),
      N8N_WEBHOOK_SECRET: Boolean(process.env.N8N_WEBHOOK_SECRET),
    },
  });
}
