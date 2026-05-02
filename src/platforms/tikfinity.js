// src/platforms/tikfinity.js
// HTTP webhook endpoint that TikFinity (or any other tool) can POST to.
//
// Configure a TikFinity custom command with action type "Webhook":
//   URL:    http://127.0.0.1:7280/tikfinity
//   Method: POST
//   Body:   {"user":"{username}","query":"{message}"}
//   Header (optional): X-Webhook-Secret: <your TIKFINITY_SECRET>
//
// Endpoints:
//   /tikfinity         -> !play
//   /tikfinity/np      -> !nowplaying
//   /tikfinity/queue   -> !songqueue
//   /tikfinity/skip    -> !skip
//   /tikfinity/revoke  -> !revoke
//
// This adapter accepts a wide variety of field names because different
// versions / forks of TikFinity send different keys for the same data.

import express from 'express';

export function startTikfinity({ port, secret, queue, skipAllowlist, log }) {
  if (!port || port === 0) {
    log.info('[tikfinity] disabled (TIKFINITY_PORT=0)');
    return null;
  }

  const app = express();
  // Accept JSON, urlencoded, and plain text — TikFinity may send any of them.
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: true, limit: '64kb' }));
  app.use(express.text({ limit: '64kb', type: 'text/*' }));

  // Auth middleware (only enforces if a secret is set).
  app.use((req, res, next) => {
    if (!secret) return next();
    if (req.get('X-Webhook-Secret') !== secret) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Diagnostic endpoint — POST anything here to see exactly how the bot parses it.
  // Useful for figuring out which field names TikFinity is using.
  app.post('/tikfinity/echo', (req, res) => {
    const body = req.body;
    const parsed = parseTikfinityBody(body, '');
    log.info('[tikfinity.echo] raw body:', typeof body === 'string' ? body : JSON.stringify(body));
    log.info('[tikfinity.echo] parsed as:', parsed);
    res.json({ ok: true, raw: body, parsed });
  });

  const respond = (res) => {
    let captured = '';
    return {
      reply: (msg) => { captured = msg; },
      flush: () => res.json({ ok: true, message: captured || null }),
    };
  };

  app.post('/tikfinity', async (req, res) => {
    const { user, query } = parseTikfinityBody(req.body);
    log.info(`[tikfinity] !play user="${user}" query="${query}"`);
    if (!query) {
      log.warn('[tikfinity] empty query. Raw body:',
        typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    }
    const r = respond(res);
    await queue.handleRequest({ user, query, platform: 'tiktok', reply: r.reply });
    r.flush();
  });

  app.post('/tikfinity/np', async (req, res) => {
    const { user } = parseTikfinityBody(req.body);
    const r = respond(res);
    await queue.handleNowPlaying({ user, reply: r.reply });
    r.flush();
  });

  app.post('/tikfinity/queue', async (req, res) => {
    const { user } = parseTikfinityBody(req.body);
    const r = respond(res);
    await queue.handleQueuePeek({ user, reply: r.reply });
    r.flush();
  });

  app.post('/tikfinity/skip', async (req, res) => {
    const { user } = parseTikfinityBody(req.body);
    const r = respond(res);
    await queue.handleSkip({ user, reply: r.reply, allowlist: skipAllowlist });
    r.flush();
  });

  app.post('/tikfinity/revoke', async (req, res) => {
    const { user } = parseTikfinityBody(req.body);
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

/**
 * Try every common field name TikFinity might use for the user and message.
 * Accepts JSON objects, urlencoded forms, and plain-text bodies.
 *
 * Recognized USER fields (case-insensitive):
 *   user, username, userName, nickname, nickName, displayname, displayName,
 *   author, name, sender, uniqueId, profileName
 *
 * Recognized QUERY fields:
 *   query, message, msg, text, comment, args, content, body, value, command
 *
 * If body is a string, the whole string is treated as the query.
 */
export function parseTikfinityBody(body, defaultUser = 'viewer') {
  let user = defaultUser;
  let query = '';

  if (typeof body === 'string') {
    // Plain-text body — treat entire body as the query.
    query = body.trim();
  } else if (body && typeof body === 'object') {
    // Try JSON / urlencoded object. Keys may be at any nesting level
    // (TikFinity sometimes wraps things in event/data envelopes).
    const flat = flattenObject(body);
    user = pickFirst(flat, USER_KEYS, defaultUser);
    query = pickFirst(flat, QUERY_KEYS, '');
  }

  // If the query starts with a leading "!play" (in case TikFinity passes the
  // whole chat line including the trigger), strip it.
  query = query.replace(/^!\w+\s+/i, '').trim();

  return { user: String(user || defaultUser).slice(0, 80), query: String(query || '').slice(0, 200) };
}

const USER_KEYS = [
  'user', 'username', 'nickname', 'displayname', 'author',
  'name', 'sender', 'uniqueid', 'profilename',
];
const QUERY_KEYS = [
  'query', 'message', 'msg', 'text', 'comment',
  'args', 'content', 'body', 'value', 'command', 'param',
];

function pickFirst(flatObj, candidateKeys, fallback) {
  for (const key of Object.keys(flatObj)) {
    const lower = key.toLowerCase().split('.').pop();
    if (candidateKeys.includes(lower)) {
      const v = flatObj[key];
      if (v != null && v !== '') return v;
    }
  }
  return fallback;
}

// Flatten {a: {b: 1}} -> {'a.b': 1}, leaving primitives in place.
function flattenObject(obj, prefix = '', acc = {}) {
  if (obj == null || typeof obj !== 'object') return acc;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flattenObject(v, path, acc);
    } else {
      acc[path] = v;
    }
  }
  return acc;
}
