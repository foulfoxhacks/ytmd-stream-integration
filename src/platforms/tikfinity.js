// src/platforms/tikfinity.js
// HTTP webhook endpoint that TikFinity (or any other tool) can POST to.
//
// Configure a TikFinity custom command with action type "Webhook":
//   URL:    http://127.0.0.1:7280/tikfinity
//   Method: POST
//   Body:   {"user":"{username}","query":"{message}"}
//   Header (optional): X-Webhook-Secret: <your TIKFINITY_SECRET>
//
// You can map multiple TikFinity events to different paths:
//   /tikfinity         -> song request (!play)
//   /tikfinity/np      -> now playing       (!nowplaying)
//   /tikfinity/queue   -> queue peek        (!songqueue)
//   /tikfinity/skip    -> skip              (!skip, subject to skip allowlist)
//   /tikfinity/revoke  -> revoke last song  (!revoke)

import express from 'express';

export function startTikfinity({ port, secret, queue, skipAllowlist, log }) {
  if (!port || port === 0) {
    log.info('[tikfinity] disabled (TIKFINITY_PORT=0)');
    return null;
  }

  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // Auth middleware (only enforces if a secret is set).
  app.use((req, res, next) => {
    if (!secret) return next();
    if (req.get('X-Webhook-Secret') !== secret) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  });

  // Health check
  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Replies are returned in the JSON body so you can wire them back into
  // TikFinity's "send chat message" action if you want.
  const respond = (res) => {
    let captured = '';
    return {
      reply: (msg) => { captured = msg; },
      flush: () => res.json({ ok: true, message: captured || null }),
    };
  };

  app.post('/tikfinity', async (req, res) => {
    const user = (req.body?.user || 'viewer').toString();
    const query = (req.body?.query || '').toString();
    const r = respond(res);
    await queue.handleRequest({ user, query, platform: 'tiktok', reply: r.reply });
    r.flush();
  });

  app.post('/tikfinity/np', async (req, res) => {
    const user = (req.body?.user || 'viewer').toString();
    const r = respond(res);
    await queue.handleNowPlaying({ user, reply: r.reply });
    r.flush();
  });

  app.post('/tikfinity/queue', async (req, res) => {
    const user = (req.body?.user || 'viewer').toString();
    const r = respond(res);
    await queue.handleQueuePeek({ user, reply: r.reply });
    r.flush();
  });

  app.post('/tikfinity/skip', async (req, res) => {
    const user = (req.body?.user || 'viewer').toString();
    const r = respond(res);
    await queue.handleSkip({ user, reply: r.reply, allowlist: skipAllowlist });
    r.flush();
  });

  app.post('/tikfinity/revoke', async (req, res) => {
    const user = (req.body?.user || 'viewer').toString();
    const r = respond(res);
    await queue.handleRevoke({ user, platform: 'tiktok', reply: r.reply });
    r.flush();
  });

  const server = app.listen(port, '127.0.0.1', () => {
    log.info(`[tikfinity] webhook listening on http://127.0.0.1:${port}`);
  });
  server.on('error', (err) => log.error('[tikfinity] server error:', err.message));
  return server;
}
