# @deepseek-ai/dsh-client-ui-settings-connections

English | [中文](README.zh.md)

The Connect-your-AI page, over the Host [connection directory](../../credentials/connections/README.md). One card per offered backend: a product name, one sentence, a state word, and one obvious button. Every technical fact behind that state word — credential references, record scopes, settings namespaces, provider routes — stays on the Host; what crosses the wire is already the four states and the one repair each implies, so this page renders an account connection rather than a provider profile. Someone who wants the profile is on the Models page, and this section sits ahead of it in the navigation because connecting an account is the question a person arrives with.

## One store, two surfaces

The settings section and the `settings.onboarding` step share one store and one set of card actions (`cardActions`). A sign-in started in the first-run takeover is the attempt the settings page shows, neither surface can drift into offering a different repair for the same state, and the step ends the moment any connection lands — so the person who just signed in is never left looking at a takeover asking them to sign in.

The step owns the moment the official-DeepSeek credential step used to own. It asks the wider question — which of the offered backends, by sign-in or by typed key — so running both would leave anyone who defers the first looking at a narrower second one. It asks nothing when the directory has not loaded, failed to load, or offers nothing: first run is a nudge toward a page that exists either way, and blocking it on a failed read would trap someone behind a surface that cannot help them.

## A sign-in is the card, not a dialog

While an attempt runs, the card becomes the conversation: the flow's latest notice, the page it wants opened, the code it wants entered, then its question with a field. The steps are the flow's own, so nothing here knows how any provider's OAuth works, and a provider whose flow asks something new needs no change on this page. `secret` masks its field and stays out of autofill; `select` renders its options as buttons. Continue stays inert until there is something to send, and an answered question is cleared before the answer goes out, so nobody can send the same code twice.

The card says to keep the page open. That is not decoration: an attempt lives only in the process that started it, so a reload abandons it.

## Every state names its own repair

`not-connected` offers Connect, and adds one sentence when the vendor's own command-line tool is installed — the same account, one click, no file of theirs is read. A backend reached by a typed key instead shows a masked field: the value is write-only past submit, so the field clears rather than leaving a secret on screen that nothing can read back. `setup-required` offers Finish setup. `needs-attention` offers a fresh sign-in, except for a credential the launch environment supplies, which offers nothing because nothing this page can write would change it. `connected` offers Use for new chats until it is the one in use. Disconnect appears only for something this app itself stored, and its confirmation names the connection and says plainly that it forgets a local sign-in rather than signing anyone out.

`not-connected` carries no status dot. Nothing is wrong with a backend a person simply has not chosen, and a coloured dot there would read as a problem to fix.

## Convergence

The Host folds every owner that can move the directory into one payload-free `connections/changed`, so a sign-in finished in another tab, a hand-edited `settings.yaml`, and a credential removed elsewhere all converge without polling; `connection/reset` re-reads after a reconnected transport. The conversation frames ride separately because they belong to one attempt rather than to the directory. Every mutation re-reads the whole directory instead of patching a row: one connection's status is a join over four owners, and a locally-applied increment would be this page's guess at what that join now says.

## Model Experience

None, as this package renders a browser configuration surface; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **A reload during a sign-in loses it** — the attempt is not durable anywhere, so the card can only warn. Resuming needs a store the authorization seam does not have.
- **Only the latest notice is shown while an attempt runs** — earlier ones move into the collapsed history once it settles. A flow that says several things at once shows only the last of them at the moment it matters.
- **Remote browsers get an inert page** — the directory rides the Host Remote, so a non-loopback browser reads nothing and every button is dead. The page renders its read failure rather than a tailored explanation.
- **The step only knows the backends this deployment offers** — someone whose only usable provider is a route outside `Config.connections` is still asked, because the directory cannot judge a route it does not carry. Deferring is one click and nothing is blocked behind it, but the step it replaced ended for any reachable provider.
- **The card offers the flow's first method** — a backend whose flow offers several ways in (a subscription sign-in and a typed key) shows only the first. Choosing among them needs a control this page does not draw.
