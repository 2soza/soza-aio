# Command authorization

- Keep restricted command authorization in a shared server-side helper checking Discord permissions and the configured bot owner, so prefix and slash handlers enforce identical rules without relying on custom server roles.
- Do not restrict slash-command default permissions to Administrator when the bot owner must also be able to invoke the command without that permission; enforce access in the handler.

# Fun economy luck

- Keep pray points and cooldown in the global FunEconomy account with an atomic conditional update, so concurrent commands and bot restarts cannot bypass the cooldown.
- Keep probability math in funeconomy/luckMath.js and use it in both coinflip and slots, so bonuses stay bounded and payout amounts remain unchanged.
- Load pray through the existing fun economy dispatcher and registration gate; never auto-register players through pray.
