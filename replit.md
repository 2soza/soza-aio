# Run the Discord bot on Replit

## Required secrets

Add these in Replit Secrets before starting the bot:

- `TOKEN` — Discord bot token
- `MONGODB_URI` — MongoDB connection URI

The bot exits with an explicit error if either value is missing. Other API keys are only needed for the optional features that use them.

## Lavalink music nodes

The music player needs a reachable Lavalink server. Voice-only `/join` and saved `/247` presence use Discord voice directly and do not require Lavalink. To override the imported node list, add `LAVALINK_NODES_JSON` as a JSON array. Both Akeno-style entries (`url`, `auth`, `secure`) and Riffy-style entries (`host`, `port`, `password`, `secure`) are accepted; the app converts Akeno's `url`/`auth` fields to Riffy's `host`/`password` fields.

If using the public nodes from the Akeno repository, copy its current values exactly. Its documented primary host is `lavalinkv4.serenetia.com:443` (including the `v` after `lavalink`). Keep node authentication in Railway Variables or Replit Secrets, not in a committed file or chat. Public/shared nodes can be unavailable or have their credentials changed. Startup logs show which configuration source was used and each configured node's host and connection/probe results, without logging passwords. If Railway Console reports that `LAVALINK_NODES_JSON` was not used, check that the variable is attached to the active service/environment and redeploy that service. If music reports no healthy node, inspect Railway Console for `[V2 LAVALINK]` and `[RIFFY]` messages; `/join` does not depend on Lavalink.

## Start

Install the locked dependencies and start the bot:

```sh
pnpm install --frozen-lockfile
pnpm start
```

The bot runs as a background console process; it does not serve a web page.

## TempVoice panel emojis

The TempVoice panel looks up application emojis by name when it starts. The expected names are:

| Button | Application emoji name |
| --- | --- |
| Name | `10000004015` |
| Limit | `10000004016` |
| Privacy | `10000004017` |
| Waiting Room | `10000004018` |
| Chat | `10000004019` |
| Trust | `10000004020` |
| Untrust | `10000004021` |
| Invite | `10000004022` |
| Kick | `10000004023` |
| Region | `10000004024` |
| Block | `10000004025` |
| Unblock | `10000004026` |
| Claim | `10000004027` |
| Transfer | `10000004028` |
| Delete | `10000004014` |

The bot fetches these from its Discord application's emoji list and uses them on the buttons. If a name is missing or unavailable, the matching Unicode emoji is used and a warning is written to the bot log. The button-label image is attached to the panel automatically.
