# Run the Discord bot on Replit

## Required secrets

Add these in Replit Secrets before starting the bot:

- `TOKEN` — Discord bot token
- `MONGODB_URI` — MongoDB connection URI

The bot exits with an explicit error if either value is missing. Other API keys are only needed for the optional features that use them.

## Lavalink music nodes

The music player needs a reachable Lavalink server. To override the imported node list, add `LAVALINK_NODES_JSON` in Replit Secrets as a JSON array. Both Akeno-style entries (`url`, `auth`, `secure`) and Riffy-style entries (`host`, `port`, `password`, `secure`) are accepted. Keep node authentication in Secrets rather than committing it to a file. Public/shared nodes can be unreliable and may have their own usage limits.

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
