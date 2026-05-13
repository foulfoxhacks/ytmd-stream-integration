// Smoke test: stand up a fake YTMD API and exercise QueueManager.
// Not committed to the repo (lives outside src/). Run with `node test-smoke.mjs`.
import http from 'node:http';
import { YTMDClient, extractFirstSong } from './src/ytmd.js';
import { QueueManager } from './src/queue-manager.js';

// --- Fake YTMD server ---
const calls = { search: 0, queue: 0, song: 0 };
const fakeSearchResponse = {
  contents: {
    tabbedSearchResultsRenderer: {
      tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [
        { musicShelfRenderer: { contents: [
          { musicResponsiveListItemRenderer: {
              playlistItemData: { videoId: 'dQw4w9WgXcQ' },
              flexColumns: [
                { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Never Gonna Give You Up' }] } } },
                { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Rick Astley - Song - 3:33' }] } } },
                { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: '3:33' }] } } },
              ],
          } },
        ] } },
      ] } } } }],
    },
  },
};

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/api/v1/search' && req.method === 'POST') {
      calls.search++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(fakeSearchResponse));
    } else if (req.url === '/api/v1/queue' && req.method === 'POST') {
      calls.queue++;
      const parsed = JSON.parse(body);
      if (!parsed.videoId) { res.writeHead(400); return res.end(); }
      res.writeHead(204); res.end();
    } else if (req.url === '/api/v1/song' && req.method === 'GET') {
      calls.song++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ title: 'Currently Playing', artist: 'Test Artist' }));
    } else {
      res.writeHead(404); res.end();
    }
  });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const host = `http://127.0.0.1:${port}`;
console.log('fake YTMD on', host);

// --- Tests ---
let pass = 0, fail = 0;
const t = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  ok   ', name); }
  else { fail++; console.log('  FAIL ', name, extra); }
};

// 1. extractFirstSong parses the YT renderer shape
const parsed = extractFirstSong(fakeSearchResponse);
t('extractFirstSong returns videoId', parsed?.videoId === 'dQw4w9WgXcQ', JSON.stringify(parsed));
t('extractFirstSong returns title', parsed?.title === 'Never Gonna Give You Up');
t('extractFirstSong parses duration', parsed?.durationSec === 213, `got ${parsed?.durationSec}`);

// 2. End-to-end through QueueManager
const ytmd = new YTMDClient({ host, token: 'fake' });
const replies = [];
const qm = new QueueManager({
  ytmd,
  cooldownSeconds: 5,
  maxSongSeconds: 600,
  maxPerUser: 2,
  blocklist: ['badword'],
  logger: { info() {}, warn() {}, error: console.error },
});

await qm.handleRequest({ user: 'alice', query: 'rick astley', platform: 'twitch', reply: (m) => replies.push(m) });
t('happy path: reply contains "added"', replies.at(-1)?.includes('added'), replies.at(-1));
t('happy path: search was called', calls.search === 1);
t('happy path: queue was called', calls.queue === 1);

// 3. Cooldown blocks rapid second request
await qm.handleRequest({ user: 'alice', query: 'whatever', platform: 'twitch', reply: (m) => replies.push(m) });
t('cooldown enforced', replies.at(-1)?.includes('slow down'), replies.at(-1));

// 4. Different user can request
await qm.handleRequest({ user: 'bob', query: 'rick astley', platform: 'twitch', reply: (m) => replies.push(m) });
t('different user not blocked by cooldown', replies.at(-1)?.includes('added'), replies.at(-1));

// 5. Blocklist
await qm.handleRequest({ user: 'carol', query: 'badword song', platform: 'twitch', reply: (m) => replies.push(m) });
t('blocklist rejects', replies.at(-1)?.includes('blocked'), replies.at(-1));

// 6. Empty query
await qm.handleRequest({ user: 'dave', query: '   ', platform: 'twitch', reply: (m) => replies.push(m) });
t('empty query gives usage', replies.at(-1)?.includes('usage'), replies.at(-1));

// 7. Now playing
const npReplies = [];
await qm.handleNowPlaying({ user: 'eve', reply: (m) => npReplies.push(m) });
t('now-playing returns title', npReplies[0]?.includes('Currently Playing'), npReplies[0]);

// 8. Skip allowlist
const skipReplies = [];
await qm.handleSkip({ user: 'rando', reply: (m) => skipReplies.push(m), allowlist: ['mod1'] });
t('skip blocks non-allowlisted', skipReplies[0]?.includes("can't skip"), skipReplies[0]);

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
