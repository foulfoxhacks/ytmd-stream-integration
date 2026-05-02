// src/index.js
// Entrypoint: load config, build the YTMD client + queue manager,
// start whichever platforms are configured.
import 'dotenv/config';
import { YTMDClient } from './ytmd.js';
import { QueueManager } from './queue-manager.js';
import { startTwitch } from './platforms/twitch.js';
import { startYouTube } from './platforms/youtube.js';
import { startTikfinity } from './platforms/tikfinity.js';

const log = {
  info: (...a) => console.log(new Date().toISOString(), ...a),
  warn: (...a) => console.warn(new Date().toISOString(), ...a),
  error: (...a) => console.error(new Date().toISOString(), ...a),
};

const env = process.env;

if (!env.YTMD_TOKEN) {
  log.error('YTMD_TOKEN is not set. Run `npm run auth` first to get one.');
  process.exit(1);
}

const ytmd = new YTMDClient({
  host: env.YTMD_HOST || 'http://127.0.0.1:26538',
  token: env.YTMD_TOKEN,
});

try {
  await ytmd.getCurrentSong();
  log.info('[ytmd] connected.');
} catch (err) {
  log.error('[ytmd] connection check failed:', err.message);
  log.error('Is Pear Desktop running and the API Server plugin enabled? Is YTMD_TOKEN current?');
  process.exit(1);
}

const queue = new QueueManager({
  ytmd,
  cooldownSeconds: parseInt(env.COOLDOWN_SECONDS || '60', 10),
  maxSongSeconds: parseInt(env.MAX_SONG_SECONDS || '420', 10),
  maxPerUser: parseInt(env.MAX_PER_USER || '2', 10),
  blocklist: (env.BLOCKLIST || '').split(',').map((s) => s.trim()).filter(Boolean),
  queuePosition: (env.QUEUE_POSITION || 'INSERT_AFTER_CURRENT_VIDEO').trim(),
  logger: log,
});

const commands = {
  request: (env.CMD_REQUEST || 'play').toLowerCase(),
  nowPlaying: (env.CMD_NOWPLAYING || 'nowplaying').toLowerCase(),
  queue: (env.CMD_QUEUE || 'songqueue').toLowerCase(),
  skip: (env.CMD_SKIP || 'skip').toLowerCase(),
  revoke: (env.CMD_REVOKE || 'revoke').toLowerCase(),
};

const skipAllowlist = (env.SKIP_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean);

startTwitch({
  channel: env.TWITCH_CHANNEL,
  username: env.TWITCH_USERNAME,
  oauth: env.TWITCH_OAUTH,
  commands,
  queue,
  skipAllowlist,
  log,
});

startYouTube({
  channelId: env.YOUTUBE_CHANNEL_ID,
  commands,
  queue,
  skipAllowlist,
  log,
});

startTikfinity({
  port: parseInt(env.TIKFINITY_PORT || '7280', 10),
  secret: env.TIKFINITY_SECRET,
  queue,
  skipAllowlist,
  log,
});

log.info('ytmd-stream-integration is running. Press Ctrl+C to quit.');

process.on('SIGINT', () => {
  log.info('Shutting down.');
  process.exit(0);
});
