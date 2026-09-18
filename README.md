# System One Router

An npm-installable smart per-turn router extension for the [pi-coding-agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent). It chooses a `high`, `medium`, or `low` profile tier based on task intent, session budget, context size, and custom rules — with phase awareness and execution-model fallbacks.

This package is based on [yeliu84/pi-model-router](https://github.com/yeliu84/pi-model-router) and retains its MIT license and attribution. See [UPSTREAM.md](UPSTREAM.md) for the imported baseline.

## Quick start

1. Install the public extension:

   ```bash
   pi install npm:system-one-router
   ```

   `npm:` is required: without it, Pi interprets `system-one-router` as a local directory path. If you previously installed this repository with `pi install .`, remove that copy first with `pi remove .`.

2. Set your TypeSafe API key in the shell that will launch Pi:

   ```bash
   export TYPESAFE_API_KEY='your-typesafe-api-key'
   ```

3. Create `.pi/model-router.json` in the project you want to route, using this model map:

   ```json
   {
     "classifier": {
       "provider": "typesafe",
       "type": "system-one",
       "model": "jev-latest",
       "timeoutMs": 3000
     },
     "profiles": {
       "auto": {
         "high": {
           "model": "openai-codex/gpt-6-astra",
           "thinking": "high"
         },
         "medium": {
           "model": "openai-codex/gpt-5.6-terra",
           "thinking": "medium"
         },
         "low": {
           "model": "openai-codex/gpt-5.6-luna",
           "thinking": "high"
         }
       }
     }
   }
   ```

4. Start Pi and activate the profile:

   ```text
   /router profile auto
   /router debug on
   ```

   Send a prompt, then use `/router debug show` to see the selected tier and classifier. After changing the JSON, use `/router reload` or restart Pi. If a prior all-tier thinking override masks the tier settings, reset it with `/router thinking auto`.

## What it does

- **Logical Router Provider**: Registers a `router` provider that exposes stable profiles (e.g., `router/balanced`) as models.
- **Per-Turn Routing**: Intelligently chooses between `high`, `medium`, and `low` tiers for every turn based on task intent and complexity.
- **Task-Aware Heuristics**: Detects planning vs. implementation vs. lightweight tasks using keyword analysis, word count, and conversation history.
- **Advanced Controls**: Includes built-in support for:
  - **LLM Intent Classifier**: Optionally use a fast model to categorize intent (overrides heuristics).
  - **Custom Rules**: Define keyword-based tier overrides for specific patterns (e.g., `deploy` → `high`).
  - **Cost Budgeting**: Set a session spend limit; high tier downgrades to medium once exceeded.
  - **Fallback Chains**: Automatic retry with alternative models if the primary choice fails.
- **Phase Memory**: Biased stickiness to keep you in the same tier during multi-turn planning or implementation work.
- **Thinking Control**: Full control over reasoning/thinking levels per tier and profile. Changing pi's thinking level (e.g. via `shift+tab`) automatically applies as an all-tier override for the active router profile.
- **Persistent State**: Pins, profiles, costs, and debug history are remembered across agent restarts and conversation branches.

## Installation

### As a user

Install the public npm package:

```bash
pi install npm:system-one-router
```

To install a checked-out local copy instead:

```bash
pi install /absolute/path/to/system-one-router
```

### For development

From this repository:

```bash
pi install .
```

Or load directly for one run:

```bash
pi -e ./extensions/index.ts
```

## Configuration

Copy the example config to one of:

- `~/.pi/agent/model-router.json` (Global)
- `.pi/model-router.json` (Project-specific)

### Basic Config Shape

```json
{
  "classifier": {
    "provider": "typesafe",
    "type": "system-one",
    "model": "jev-latest",
    "timeoutMs": 3000
  },
  "classifierModel": "google/gemini-flash-latest",
  "maxSessionBudget": 1.0,
  "profiles": {
    "auto": {
      "high": { "model": "openai/gpt-5.4-pro", "thinking": "high" },
      "medium": { "model": "google/gemini-flash-latest", "thinking": "medium" },
      "low": { "model": "openai/gpt-5.4-nano", "thinking": "low" }
    }
  }
}
```

### Configuration Fields

| Field                   | Description                                                                       |
| ----------------------- | --------------------------------------------------------------------------------- |
| `classifier`            | (Optional) TypeSafe System One configuration. When enabled, Jev runs before `classifierModel`. Use `null` in a project config to disable an inherited TypeSafe classifier. |
| `classifierModel`       | (Optional) Model used to categorize intent. Supports model aliases. If omitted, fast heuristics are used. |
| `maxSessionBudget`      | (Optional) USD budget for the session. Forces `medium` tier once exceeded.        |
| `phaseBias`             | (0.0 - 1.0) Stickiness of the current phase. Higher = more stable. Default `0.5`. |
| `rules`                 | List of custom keyword rules (e.g. `{ "matches": "deploy", "tier": "high" }`).    |
| `models`                | (Optional) Map of model aliases to definitions with `model`, `contextWindow`, `maxTokens`. |
| `profiles`              | Map of profile definitions, each containing optional `high`, `medium`, and `low` tiers (at least one required). Tier models can reference aliases from `models`. |

### TypeSafe Jev classification

Set the TypeSafe credential in the Pi process environment before starting Pi:

```bash
export TYPESAFE_API_KEY='your-typesafe-api-key'
pi
```

`classifier` is optional. When configured, System One sends one `tier` Choice question to Jev. Its state contains at most 8,000 characters of the latest user message and the last 8,000 characters of the recent four-message history, plus the current router phase. No request or response body is written to router debug output.

Jev’s selected tier supplies the configured tier model and thinking level. If that tier is not configured for the active profile, the router uses its existing nearest-available-tier resolver. A missing key, timeout, HTTP error, network error, or invalid System One response falls through to `classifierModel` when configured. That LLM classifier has a 10-second limit; if it also cannot classify, the existing local heuristics make the decision. Cancelling a Pi request stops this chain rather than starting the next classifier.

Enable `/router debug on`, make a request, then run `/router debug show` to inspect whether Jev, the LLM fallback, or heuristics routed the turn. Failure reasons are short sanitized codes such as `request-timeout`; credentials and API payloads are never shown.

Project configuration replaces the whole `classifier` block instead of deep-merging it. Set `"classifier": null` in `.pi/model-router.json` to disable an inherited global Jev configuration while leaving `classifierModel` unchanged.

Only load one router extension at a time: this package and the upstream router both register the `router` provider.

## Commands

| Command                     | Description                                                                     |
| --------------------------- | ------------------------------------------------------------------------------- |
| `/router`                   | Show detailed status, current profile, spend, and settings.                     |
| `/router status`            | Alias for `/router` (show current status).                                      |
| `/router profile [name]`    | Switch to a profile or list available ones (enables router if off).             |
| `/router pin <t\|a>`        | Pin a tier (high/medium/low/auto) for the active profile.                      |
| `/router fix <tier>`        | Correct the _last_ decision and pin that tier for the current profile.          |
| `/router thinking <level>`  | Override thinking level for all tiers (e.g. `/router thinking max`). Not all tier models may support every level. |
| `/router thinking <tier> <level>` | Override thinking level for a specific tier (e.g. `/router thinking low off`). |
| `/router disable`           | Disable the router and switch back to the last non-router model.                |
| `/router widget <on\|off>`  | Toggle the persistent state widget (supports `toggle`).                         |
| `/router debug <on\|off>`   | Toggle turn-by-turn routing notifications (supports `toggle`, `clear`, `show`). |
| `/router reload`            | Hot-reload the configuration JSON.                                              |
| `/router help`              | Show usage help for all subcommands.                                            |

## Documentation

- [Architecture Guide](docs/ARCHITECTURE.md): Deep dive into the routing logic and modular design.
- [Sample Configuration](model-router.example.json): Diverse profile examples (`cheap`, `deep`, `balanced`).
