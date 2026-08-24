# anthropic-login

English | [中文](README.zh.md)

Boot-time sign-in for a pi-ai catalog provider that ships an OAuth login — by default Anthropic's "Claude Pro/Max" subscription flow.

[`@deepseek-ai/dsh-llm-pi-ai`](../../packages/llm/llm-pi-ai/README.md) already registers one authorization flow per installed catalog provider, and the flow itself owns the protocol and the credential write. What no shipped surface does is *call* it: the Web UI's Models page only edits api-key credentials, and the CLI has no `login` command. This overlay is that missing caller — a terminal interaction handed to `ctx.authorization.begin()` during boot.

## Run it

A patch file contributes configuration but does not move the directory the loader resolves module paths from, and `name` is imported verbatim — no expression escape. The overlay's relative specifier therefore resolves against the booted profile's directory, so the plugin goes there first:

```sh
cp examples/anthropic-login/anthropic-login.mjs "${DSH_HOME:-$HOME/.dsh}/profiles/web/"
dsh web --patch ./examples/anthropic-login/cordis.yml
```

Another profile takes the same two steps against its own directory. An absolute `name` works too and needs no copy, at the cost of pinning the overlay to one checkout.

The sign-in needs a terminal: run the profile from an interactive shell, because the flow asks where to send you and what came back. Notices and prompts are written to stderr so a protocol stdout stays clean.

Once a credential exists the plugin stays out of the way — it reports the stored record and does nothing, because pi-ai owns refresh from there on. Set `force: true` in [`cordis.yml`](cordis.yml) to sign in again anyway.

## What it mounts

| Row | Why |
|---|---|
| `authorization` | `ctx.authorization` is the seam that owns sign-in conversations. No shipped bundle mounts it, and pi-ai registers its login flows inside `ctx.inject(['authorization'], …)`, so without this row those flows never exist. |
| `anthropic-login` | The caller. Resolves `<scope>/<provider>` (`llm-pi-ai/anthropic`), waits for pi-ai to register that flow, then runs the named method. |

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `scope` | `llm-pi-ai` | Credential key scope; pi-ai's `RECORD_SCOPE`. |
| `provider` | `anthropic` | pi-ai catalog provider id, which is also the credential record id. |
| `method` | `oauth` | `oauth` is the subscription login; `api-key` types a key instead. |
| `force` | `false` | Sign in again even when a credential is already stored. |
| `waitMs` | `15000` | How long to wait for the flow to be registered. |
| `pollMs` | `250` | How often to look for it. |

## Failure is contained

A sign-in that cannot finish must not take the boot down: every other capability in the tree still works, and the next start can retry. Two disciplines carry that promise.

The attempt is detached, because `apply` runs inside the boot sequence — an awaited browser round trip there would hold the whole tree, and the human it waits on cannot answer until the surface they are being sent to is up. Nothing awaits the attempt, so its rejection would otherwise be an unhandled one, which `installFailLoud` treats as fatal; the plugin reports the last resort itself and swallows it.

The poll loop checks withdrawal before it touches the service and reads it through `ctx.get('authorization')` rather than `ctx.authorization`. The injected getter throws `cannot get required service "authorization" in inactive context` once the fiber leaves `ACTIVE`, and this loop outlives the tree whenever boot tears down while it is still polling — the optional accessor returns `undefined` there instead.
