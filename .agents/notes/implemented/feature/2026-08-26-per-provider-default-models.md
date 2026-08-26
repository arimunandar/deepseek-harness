# Agent Note: per-provider default models

Status: implemented

English | [中文](2026-08-26-per-provider-default-models.zh.md)

## Problem

Switching to a provider did not say which of its models to switch to.

`agent-default-model` held one selection for the whole deployment — a provider and a model together. Every gesture that changes provider therefore has to invent the model half: the [connection directory](2026-08-26-connect-your-ai-directory.md)'s "Use for new chats" carried a `defaultModel` per configured connection, and a provider with no connection card had no answer at all.

Nothing derivable fills that gap. Every shipped catalog lists its models in its own order — alphabetical, for all of them — so "the first model" is `claude-fable-5` for Anthropic and `gpt-4` for OpenAI. There is no flagship marker, no release date, and no ordering that means anything.

The Models page had a second, unrelated gap: a row showed a provider's name and nothing else. Two routes serving one vendor through different adapters — `deepseek-official` on `llm-deepseek` and a pi-ai catalog `deepseek`, both reading `DEEPSEEK_API_KEY` — appeared as two rows differing only in the case of their names.

## Decision

`agent-default-model` gains `perProvider`, a route-keyed map of model ids, with `modelFor`, `saveProviderDefault`, and `clearProviderDefault` beside the existing selection. It lives there rather than in each adapter's own profile because the question is adapter-agnostic and that package already owns "which model do we start with"; putting it in `llm-pi-ai` and `llm-deepseek` would duplicate one concept into two schemas.

An absent entry stays absent. Nothing seeds a guess, and `modelFor` answers undefined so each caller keeps its own fallback — `connections.activate()` prefers the recorded default over the `defaultModel` its configuration ships, treating the shipped value as a starting point rather than a preference.

`saveSelection` carries the map through its complete-section write. That write exists to clear a stored reasoning effort the new model does not have; dropping every route's default with it would not be. The carry keys on emptiness rather than absence, because the schema materializes the dict — the same shape that produced [the connections `routePath` bug](2026-08-26-connect-your-ai-directory.md), where an `=== undefined` guard never fired.

Each Models row now states three facts it previously withheld: the model that route starts from, as a picker over that route's own catalog; the endpoint its profile names, or that the adapter's own applies; and the adapter that owns it. The adapter tag is what tells `DeepSeek` from `deepseek`.

### The undeclared-token defect, and the gate that now catches it

The connections page shipped with every colour naming a variable the theme sheets never declare — `--dsw-alias-text-primary`, `bg-secondary`, `text-link`, and the rest were plausible-looking spellings of nothing. An undeclared custom property has no fallback, so those declarations simply did not apply: the cards rendered with no surface, no border, and no background, which is what "the UI is bad" turned out to mean.

The Models page never had the defect because a test there compares every `var(--dsw-*)` against the theme sheets. That gate is now in the connections package too, alongside one asserting the shared row surface. A design system whose misuse is silent needs the check wherever it is used, not only where it was first written.

## Alternatives considered

**Derive the default from the catalog.** Take the first entry, or the last, or the highest version number. Rejected because every ordering available is alphabetical: "first" is `gpt-4` and `claude-fable-5`, and version parsing across `gpt-5.6-terra`, `claude-opus-4-5-20251101`, and `mimo-v2.5-pro-ultraspeed` is a guess dressed as a rule. A wrong default that looks derived is worse than no default, because nobody thinks to check it.

**Store it in each adapter's provider profile.** `llm-pi-ai.providers.<route>.defaultModel` and `llm-deepseek.defaultModel` would put the value beside the route it describes. Rejected because it duplicates one concept into two schemas that would then drift, and because a third adapter would have to remember to add it. The selection owner already exists.

**Seed a `models:` list per provider instead.** Rejected as a misreading of the ask: a catalog route already serves its whole catalog, so writing an explicit list narrows what is offered rather than adding a default.

**Fix only the connections stylesheet.** Rejected as the smaller half. The tokens were wrong because nothing said they were, and the same mistake was one new page away from happening again.

## Testing

`agent-default-model` covers the map end to end: reading an absent route, recording one without disturbing the selection or its siblings, surviving a complete-section selection write, clearing one, and staying usable with no settings provider mounted.

The Models store is exercised against the wire shapes a hand-written document can actually produce — a section that is not an object, a `perProvider` that is not a map, a non-string model, an empty string — because the section arrives as `unknown`. A refused catalog read leaves every row present with an inert picker rather than failing the page.

The style gate compares every `var(--dsw-*)` in the connections stylesheets against the theme sheets, rejects a literal colour in a fallback slot, and pins the shared row surface.

## Consequences

A person can now say, once per provider, which model it starts from, and every gesture that switches provider honours it.

The map is keyed by route with nothing validating that the route or the model still exists. A renamed route leaves a dangling entry, and a model withdrawn from a catalog leaves a default the picker no longer offers — the row shows it as the selected value with no option behind it. Neither is load-bearing: the selection still resolves through the adapter, which rejects an unknown model at request time.

`llm.models` is now a fourth read in the Models page load. It is an enrichment — a refusal costs the pickers, not the page — but it is one more round trip on a surface that already made three.

## Related

- [connect-your-AI directory](2026-08-26-connect-your-ai-directory.md) — the connection cards whose `defaultModel` configuration this now outranks, and the page whose stylesheet the token gate was added for.
