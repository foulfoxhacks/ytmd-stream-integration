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

  /**
   * Request a JWT for the given clientId.
   * The user must approve the popup in Pear Desktop the first time.
   * Returns the access token string.
   */
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

  // --- Search ---
  // POST /api/v1/search { query, params?, continuation? }
  // Returns the raw YouTube Music search response. We dig out the first
  // playable songVideo from it.
  async search(query) {
    const data = await this.#req('POST', `${API}/search`, { query });
    return data;
  }

  /**
   * Search and return the first usable {videoId, title, artist, durationSec}
   * or null if nothing matched.
   */
  async findFirstSong(query) {
    const data = await this.search(query);
    return extractFirstSong(data);
  }

  // --- Queue ---
  async addToQueue(videoId, { insertPosition = 'INSERT_AT_END' } = {}) {
    return this.#req('POST', `${API}/queue`, { videoId, insertPosition });
  }

  async getQueue() {
    return this.#req('GET', `${API}/queue`);
  }

  async getCurrentSong() {
    return this.#req('GET', `${API}/song`);
  }

  async getNextSong() {
    return this.#req('GET', `${API}/queue/next`);
  }

  async next() {
    return this.#req('POST', `${API}/next`);
  }
}

/**
 * Walk a YouTube Music searchResponse and pick the first item that has a videoId
 * and looks like a song. The shape is YouTube's internal renderer JSON; we
 * defensively scan because it changes occasionally.
 */
export function extractFirstSong(data) {
  if (!data || typeof data !== 'object') return null;

  const found = [];
  walk(data, (node) => {
    if (!node || typeof node !== 'object') return;
    // musicResponsiveListItemRenderer is the standard "row" in a search result.
    if (node.musicResponsiveListItemRenderer) {
      const r = node.musicResponsiveListItemRenderer;
      const videoId =
        r?.playlistItemData?.videoId ||
        r?.overlay?.musicItemThumbnailOverlayRenderer?.content
          ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
      if (!videoId) return;
      const title = textFromRuns(r.flexColumns?.[0]);
      const artistish = textFromRuns(r.flexColumns?.[1]);
      const durationSec = parseDurationFromColumns(r.flexColumns);
      found.push({ videoId, title: title || '(unknown)', artist: artistish || '', durationSec });
    }
  });
  return found[0] || null;
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
      const a = +m[1], b = +m[2], c = m[3] ? +m[3] : null;
      return c == null ? a * 60 + b : a * 3600 + b * 60 + c;
    }
  }
  return 0;
}
