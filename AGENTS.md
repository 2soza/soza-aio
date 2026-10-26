# Command authorization

- Keep restricted command authorization in a shared server-side helper checking Discord permissions and the configured bot owner, so prefix and slash handlers enforce identical rules without relying on custom server roles.
- Do not restrict slash-command default permissions to Administrator when the bot owner must also be able to invoke the command without that permission; enforce access in the handler.
