# ytmd-stream-integration

Chat-driven song requests for **[Pear Desktop](https://github.com/th-ch/youtube-music)** (the YouTube Music Desktop App). Bridges **Twitch**, **TikTok Live** (via [TikFinity](https://tikfinity.zerody.one/)) and **YouTube Live** chat into a single song-request queue that plays through your local YouTube Music app.

- `!sr <song name>` from any platform → searched on YouTube Music → added to your queue
- Per-user cooldowns, max song length, and a blocklist
- Optional `!np`, `!queue`, `!skip` commands
- One Node.js process — no cloud, no dependencies on third-party services
- MIT licensed

## How it works

```
 Twitch chat ──┐
 TikTok chat ──┼──► ytmd-stream-integration ──► Pear Desktop API Server ──► your queue
 YouTube chat ─┘            (this bot)              (localhost:26538)
```

TikTok works through TikFinity: configure a TikFinity custom command with a Webhook action that POSTs to this bot. Twitch and YouTube are read directly via their chat APIs.

## Requirements

- **Node.js 18+** ([download](https://nodejs.org/))
- **Pear Desktop** with the **API Server** plugin enabled
- For Twitch: a bot OAuth token (your own account works)
- For TikTok: [TikFinity](https://tikfinity.zerody.one/) installed
- For YouTube Live: your channel ID

## Setup

### 1. Enable the Pear Desktop API Server

Open Pear Desktop → **Settings → Plugins → API Server** → enable it. Default port is `26538`. Leave it on `127.0.0.1` (localhost) unless you know what you're doing.

### 2. Install the bot

```bash
git clone https://github.com/foulfoxhacks/ytmd-stream-integration.git
cd ytmd-stream-integration
npm install
cp .env.example .env
```

Open `.env` in a text editor — you'll fill it in over the next few steps.

### 3. Get a YTMD auth token

```bash
npm run auth
```

A confirmation popup appears in Pear Desktop asking whether to allow the client. Click **Allow**. The terminal prints something like:

```
YTMD_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Paste that into your `.env`.

### 4. Configure the platforms you want

You can enable any subset — leave the others blank.

**Twitch.** Set `TWITCH_CHANNEL` (your channel name, lowercase), `TWITCH_USERNAME` (the bot account, can be your own), and `TWITCH_OAUTH` (an OAuth token, format `oauth:xxxx`). Easiest way to get a token: [twitchtokengenerator.com](https://twitchtokengenerator.com/) → "Bot Chat Token".

**YouTube Live.** Set `YOUTUBE_CHANNEL_ID` to your channel ID (find it at [youtube.com/account_advanced](https://www.youtube.com/account_advanced)). Note: YouTube chat is read-only here, so command replies show in the bot's terminal, not in chat. If you want viewers to see replies on YouTube, mirror them through Nightbot or similar.

**TikTok via TikFinity.** Leave `TIKFINITY_PORT=7280` (or change it), then in TikFinity:

1. Create a new custom command, e.g. trigger word `!sr`
2. Add an action of type **Webhook**
3. URL: `http://127.0.0.1:7280/tikfinity`
4. Method: `POST`, Content-Type: `application/json`
5. Body:
   ```json
   {"user": "{username}", "query": "{message}"}
   ```
   (TikFinity variables vary by version — `{username}` and `{message}` are the common ones; check TikFinity's variable list.)
6. (Optional) Set `TIKFINITY_SECRET` in `.env` and add a request header `X-Webhook-Secret: <same value>`.

Repeat for `!np` → `/tikfinity/np`, `!queue` → `/tikfinity/queue`, `!skip` → `/tikfinity/skip` if you want them.

### 5. Run

```bash
npm start
```

You should see something like:

```
[ytmd] connected.
[twitch] connected as mybot -> #mychannel
[youtube] connected to live chat ...
[tikfinity] webhook listening on http://127.0.0.1:7280
ytmd-stream-integration is running. Press Ctrl+C to quit.
```

Have someone in any of your chats type `!sr never gonna give you up`. The bot replies in chat (Twitch + TikTok) and the song appears in your YouTube Music queue.

## Commands

| Command | What it does | Who can use it |
|---|---|---|
| `!sr <song>` | Search YouTube Music and add to queue | Everyone |
| `!np` | Show currently playing song | Everyone |
| `!queue` | Show next song in queue | Everyone |
| `!skip` | Skip the current song | Only users in `SKIP_ALLOWLIST` |

Command names are configurable in `.env` (`CMD_REQUEST`, `CMD_NOWPLAYING`, etc.).

## Queue rules

Configured in `.env`:

- `COOLDOWN_SECONDS` — per-user cooldown between requests (default 60)
- `MAX_SONG_SECONDS` — reject songs longer than this (default 420 = 7 min, set 0 to disable)
- `MAX_PER_USER` — max simultaneous queued songs per user (default 2)
- `BLOCKLIST` — comma-separated lowercase substrings to reject in title/artist/query

## Troubleshooting

**"YTMD connection check failed"** — Pear Desktop isn't running, the API Server plugin isn't enabled, the port doesn't match, or the token is stale. Re-run `npm run auth`.

**Auth popup never appears** — Check Pear Desktop is in focus. The API Server plugin's auth strategy must be set to "Auth at first" (the default). If you set it to "None", you can skip `npm run auth` and put any string in `YTMD_TOKEN`.

**Twitch bot connects but doesn't respond** — Verify the OAuth token has chat scope and matches the username. Tokens expire — regenerate if it's been a while.

**TikFinity webhook returns 403** — `TIKFINITY_SECRET` doesn't match the `X-Webhook-Secret` header.

**Songs come back as "no results"** — Try a more specific query (artist + title). The bot picks the first songVideo result.

## Security notes

- The bot listens on `127.0.0.1` only — not exposed to the internet.
- Never commit your `.env` file. `.gitignore` already excludes it.
- If you change `YTMD_CLIENT_ID`, you'll have to re-approve in Pear Desktop and get a new token.
- The Twitch OAuth token gives chat access to your bot account. Treat it like a password.

## Project layout

```
src/
  index.js              entrypoint — wires everything together
  ytmd.js               client for the Pear Desktop API Server
  auth.js               one-shot script for getting a YTMD token
  queue-manager.js      cooldown / length / blocklist enforcement
  platforms/
    twitch.js           tmi.js-based Twitch chat adapter
    youtube.js          youtube-chat-based YouTube Live adapter
    tikfinity.js        Express webhook receiver for TikFinity
```

## Contributing

PRs welcome. Ideas: an approval-queue UI, votes-to-skip, per-platform command aliases, persistent stats, request history.

## License

MIT — see [LICENSE](LICENSE). Built by [Aleksandr "Sammy" Freyermuth](https://github.com/foulfoxhacks).

## Acknowledgements

- [th-ch/youtube-music](https://github.com/th-ch/youtube-music) (Pear Desktop) for the API Server plugin
- [tmi.js](https://github.com/tmijs/tmi.js) for Twitch IRC
- [youtube-chat](https://github.com/LinaTsukusu/youtube-chat) for YouTube Live chat
- [TikFinity](https://tikfinity.zerody.one/) for the TikTok-side bridge
