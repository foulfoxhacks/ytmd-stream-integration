// src/platforms/youtube.js
// YouTube Live chat is read-only via the unofficial `youtube-chat` package
// (it scrapes the live chat continuation token). It can't post replies back.
// We log replies to the console so you can see them; if you want chat replies
// on YouTube, configure a separate chatbot (Nightbot, etc.) to mirror them
// or use the official YouTube Data API with OAuth (out of scope here).
import { LiveChat } from 'youtube-chat';

export function startYouTube({ channelId, commands, queue, skipAllowlist, log }) {
  if (!channelId) {
    log.info('[youtube] disabled (YOUTUBE_CHANNEL_ID is empty)');
    return null;
  }

  const live = new LiveChat({ channelId });

  live.on('start', (liveId) => log.info(`[youtube] connected to live chat ${liveId}`));
  live.on('end', () => log.warn('[youtube] live chat ended'));
  live.on('error', (err) => log.error('[youtube] error:', err?.message || err));

  live.on('chat', async (item) => {
    const text = (item.message || []).map((m) => m.text || '').join('').trim();
    if (!text.startsWith('!')) return;

    const [rawCmd, ...rest] = text.slice(1).split(/\s+/);
    const cmd = rawCmd.toLowerCase();
    const args = rest.join(' ');
    const user = item.author?.name || 'viewer';

    const reply = (msg) => log.info(`[youtube reply -> ${user}] ${msg}`);

    if (cmd === commands.request) {
      await queue.handleRequest({ user, query: args, platform: 'youtube', reply });
    } else if (cmd === commands.nowPlaying) {
      await queue.handleNowPlaying({ user, reply });
    } else if (cmd === commands.queue) {
      await queue.handleQueuePeek({ user, reply });
    } else if (cmd === commands.skip) {
      await queue.handleSkip({ user, reply, allowlist: skipAllowlist });
    } else if (cmd === commands.revoke) {
      await queue.handleRevoke({ user, platform: 'youtube', reply });
    }
  });

  live.start().catch((e) => log.error('[youtube] start failed:', e.message));
  return live;
}
