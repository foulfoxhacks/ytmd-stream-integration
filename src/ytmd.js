// src/ytmd.js
// Thin client around the Pear Desktop / YTMD API Server plugin.
// Routes verified against:
//   https://github.com/th-ch/youtube-music/blob/master/src/plugins/api-server/backend/routes/control.ts
//   https://github.com/th-ch/youtube-music/blob/master/src/plugins/api-server/backend/routes/auth.ts

const API = '/api/v1';

export class YTMDClient {
  constructor({ host, token }) {
    if (!host) throw new Error('YTMDClient: host is required');
    this.host = host.replace(/\/+$/, '');
    this.token = token || '';
  }

  static async requestToken({ host, clientId }) {
    const url = `${host.replace(/\/+$/, '')}/auth/${encodeURIComponent(clientId)}`;
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) {
      throw new Error(`Auth failed (${res.status}). Did you click "Allow" in Pear Desktop?`);
    }
    const body = await res.json();
    if (!body.accessToken) throw new Error('Auth response missing accessToken');
    return body.accessToken;
  }

  async #req(method, path, body) {
    const res = await fetch(`${this.host}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`YTMD ${method} ${path} -> ${res.status} ${text}`);
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  }

  async search(query) {
    return this.#req('POST', `${API}/search`, { query });
  }

  async findFirstSong(query) {
    const data = await this.search(query);
    return extractFirstSong(data);
  }

  // insertPosition: 'INSERT_AT_END' or 'INSERT_AFTER_CURRENT_VIDEO'
  async addToQueue(videoId, { insertPosition = 'INSERT_AFTER_CURRENT_VIDEO' } = {}) {
    return this.#req('POST', `${API}/queue`, { videoId, insertPosition });
  }

  async getQueue() {
    try {
      return await this.#req('GET', `${API}/queue`);
    } catch (err) {
      if (/->\s*4(?:0[34]|1\d)/.test(err.message)) return null;
      throw err;
    }
  }

  async getCurrentSong() {
    return this.#req('GET', `${API}/song`);
  }

  async getNextSong() {
    try {
      return await this.#req('GET', `${API}/queue/next`);
    } catch (err) {
      if (/->\s*4(?:0[34]|1\d)/.test(err.message)) return null;
      throw err;
    }
  }

  async next() {
    return this.#req('POST', `${API}/next`);
  }

  async removeFromQueue(index) {
    return this.#req('DELETE', `${API}/queue/${encodeURIComponent(index)}`);
  }
}

export function extractFirstSong(data) {
  if (!data || typeof data !== 'object') return null;
  const found = [];
  walk(data, (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.musicResponsiveListItemRenderer) {
      const r = node.musicResponsiveListItemRenderer;
      const videoId =
        r?.playlistItemData?.videoId ||
        r?.overlay?.musicItemThumbnailOverlayRenderer?.content
          ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
      if (!videoId) return;
      const title = textFromRuns(r.flexColumns?.[0]);
      const subtitle = textFromRuns(r.flexColumns?.[1]);
      const durationSec = parseDurationFromColumns(r.flexColumns);
      let score = 0;
      if (durationSec > 0) score += 10;
      if (/views?\b/i.test(subtitle)) score -= 5;
      if (/\bSong\b/i.test(subtitle)) score += 5;
      if (subtitle.split('•').length >= 2) score += 2;
      const artist = subtitle
        .replace(/\s*•\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/, '')
        .replace(/\s*•\s*[\d.]+[KMB]?\s+views?\s*$/i, '')
        .replace(/^Song\s*•\s*/i, '')
        .trim();
      found.push({ videoId, title: title || '(unknown)', artist, durationSec, score });
    }
  });
  if (found.length === 0) return null;
  found.sort((a, b) => b.score - a.score);
  const best = found[0];
  return { videoId: best.videoId, title: best.title, artist: best.artist, durationSec: best.durationSec };
}

function walk(node, visit, seen = new WeakSet()) {
  if (!node || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);
  visit(node);
  for (const key of Object.keys(node)) {
    walk(node[key], visit, seen);
  }
}

function textFromRuns(column) {
  const runs =
    column?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ||
    column?.text?.runs;
  if (!Array.isArray(runs)) return '';
  return runs.map((r) => r.text || '').join('').trim();
}

function parseDurationFromColumns(columns) {
  if (!Array.isArray(columns)) return 0;
  for (const col of columns) {
    const txt = textFromRuns(col);
    const m = txt.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const c = m[3] ? Number(m[3]) : null;
      return c == null ? a * 60 + b : a * 3600 + b * 60 + c;
    }
  }
  return 0;
}
