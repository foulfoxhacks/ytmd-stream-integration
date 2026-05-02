// src/queue-manager.js
// Centralized "what should happen when someone requests a song" logic.
// Platform adapters call handleRequest({ user, query, platform, reply })
// and this module enforces cooldowns, length limits, and blocklist before
// pushing to YTMD.

export class QueueManager {
  constructor({ ytmd, cooldownSeconds, maxSongSeconds, maxPerUser, blocklist, logger = console }) {
    this.ytmd = ytmd;
    this.cooldown = (cooldownSeconds || 0) * 1000;
    this.maxSongSeconds = maxSongSeconds || 0;
    this.maxPerUser = maxPerUser || 0;
    this.blocklist = (blocklist || []).map((s) => s.toLowerCase()).filter(Boolean);
    this.log = logger;
    this.lastRequest = new Map(); // userKey -> timestamp ms
    this.activeCount = new Map(); // userKey -> int
  }

  #userKey(platform, user) {
    return `${platform}:${(user || '').toLowerCase()}`;
  }

  #remainingCooldown(key) {
    const last = this.lastRequest.get(key);
    if (!last) return 0;
    const remaining = this.cooldown - (Date.now() - last);
    return Math.max(0, Math.ceil(remaining / 1000));
  }

  #isBlocked(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return this.blocklist.some((b) => lower.includes(b));
  }

  /**
   * @param {{user:string, query:string, platform:string, reply:(msg:string)=>void}} req
   */
  async handleRequest({ user, query, platform, reply }) {
    const key = this.#userKey(platform, user);
    query = (query || '').trim();
    if (!query) {
      reply(`@${user} usage: !sr <song name>`);
      return;
    }

    const cd = this.#remainingCooldown(key);
    if (cd > 0) {
      reply(`@${user} slow down — try again in ${cd}s.`);
      return;
    }

    if (this.maxPerUser > 0 && (this.activeCount.get(key) || 0) >= this.maxPerUser) {
      reply(`@${user} you already have ${this.maxPerUser} song(s) in the queue.`);
      return;
    }

    if (this.#isBlocked(query)) {
      reply(`@${user} that request was blocked.`);
      return;
    }

    let song;
    try {
      song = await this.ytmd.findFirstSong(query);
    } catch (err) {
      this.log.error('[ytmd.search] failed:', err.message);
      reply(`@${user} couldn't reach YouTube Music — is the app open?`);
      return;
    }

    if (!song) {
      reply(`@${user} no results for "${truncate(query, 40)}".`);
      return;
    }

    if (this.#isBlocked(`${song.title} ${song.artist}`)) {
      reply(`@${user} that request was blocked.`);
      return;
    }

    if (this.maxSongSeconds > 0 && song.durationSec > this.maxSongSeconds) {
      reply(`@${user} "${song.title}" is too long (max ${formatDur(this.maxSongSeconds)}).`);
      return;
    }

    try {
      await this.ytmd.addToQueue(song.videoId);
    } catch (err) {
      this.log.error('[ytmd.addToQueue] failed:', err.message);
      reply(`@${user} couldn't add that to the queue.`);
      return;
    }

    this.lastRequest.set(key, Date.now());
    this.activeCount.set(key, (this.activeCount.get(key) || 0) + 1);
    // Best-effort: decay active count after the song's duration so per-user limits
    // don't hold forever. Not perfect (skips, restarts) but good enough.
    if (song.durationSec > 0) {
      setTimeout(() => {
        const cur = this.activeCount.get(key) || 0;
        if (cur > 0) this.activeCount.set(key, cur - 1);
      }, (song.durationSec + 5) * 1000);
    }

    const dur = song.durationSec ? ` (${formatDur(song.durationSec)})` : '';
    reply(`@${user} added: ${song.title} — ${song.artist}${dur}`);
    this.log.info(`[+queue] ${platform}/${user}: ${song.title} (${song.videoId})`);
  }

  async handleNowPlaying({ user, reply }) {
    try {
      const cur = await this.ytmd.getCurrentSong();
      if (!cur || !cur.title) return reply(`@${user} nothing playing right now.`);
      reply(`@${user} now playing: ${cur.title}${cur.artist ? ` — ${cur.artist}` : ''}`);
    } catch (err) {
      this.log.error('[np] failed:', err.message);
      reply(`@${user} couldn't reach YouTube Music.`);
    }
  }

  async handleQueuePeek({ user, reply }) {
    try {
      const next = await this.ytmd.getNextSong();
      if (!next || !next.title) return reply(`@${user} nothing queued up next.`);
      const title =
        typeof next.title === 'string'
          ? next.title
          : (next.title?.runs?.[0]?.text || '(unknown)');
      reply(`@${user} up next: ${title}`);
    } catch (err) {
      this.log.error('[queue] failed:', err.message);
      reply(`@${user} couldn't reach YouTube Music.`);
    }
  }

  async handleSkip({ user, reply, allowlist }) {
    const allowed = (allowlist || []).map((s) => s.toLowerCase());
    if (!allowed.includes((user || '').toLowerCase())) {
      reply(`@${user} you can't skip.`);
      return;
    }
    try {
      await this.ytmd.next();
      reply(`@${user} skipped.`);
    } catch (err) {
      this.log.error('[skip] failed:', err.message);
      reply(`@${user} couldn't skip.`);
    }
  }
}

function formatDur(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
