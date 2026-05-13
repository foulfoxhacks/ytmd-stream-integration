// src/platforms/twitch.js
import tmi from 'tmi.js';

export function startTwitch({ channel, username, oauth, commands, queue, skipAllowlist, log }) {
  if (!channel) {
    log.info('[twitch] disabled (TWITCH_CHANNEL is empty)');
    return null;
  }
  if (!username || !oauth) {
    log.warn('[twitch] TWITCH_USERNAME or TWITCH_OAUTH missing - skipping');
    return null;
  }

  const client = new tmi.Client({
    options: { debug: false },
    connection: { reconnect: true, secure: true },
    identity: { username, password: oauth },
    channels: [channel],
  });

  client.on('connected', () => log.info(`[twitch] connected as ${username} -> #${channel}`));
  client.on('disconnected', (reason) => log.warn('[twitch] disconnected:', reason));

  client.on('message', async (chan, tags, message, self) => {
    if (self) return;
    const text = (message || '').trim();
    if (!text.startsWith('!')) return;

    const [rawCmd, ...rest] = text.slice(1).split(/\s+/);
    const cmd = rawCmd.toLowerCase();
    const args = rest.join(' ');
    const user = tags['display-name'] || tags.username || 'viewer';

    const reply = (msg) => client.say(chan, msg).catch((e) => log.error('[twitch.say]', e.message));

    if (cmd === commands.request) {
      await queue.handleRequest({ user, query: args, platform: 'twitch', reply });
    } else if (cmd === commands.nowPlaying) {
      await queue.handleNowPlaying({ user, reply });
    } else if (cmd === commands.queue) {
      await queue.handleQueuePeek({ user, reply });
    } else if (cmd === commands.skip) {
      await queue.handleSkip({ user, reply, allowlist: skipAllowlist });
    }
  });

  client.connect().catch((e) => log.error('[twitch] connect failed:', e.message));
  return client;
}
