# Ponte

Agentic translator for Framer portfolios. Detects language and content type
in on-screen plain text, then returns meaning-preserving replacements so
Framer can swap copy in place across major Indian and global languages.

Built with [`@grok/agent-sdk`](https://cursor.com/docs/bdk).

## Repo

- Path: `/agent/ponte` (this directory)
- Remote `origin`: `https://github.com/krishnanlalitya95/Ponte-`
- Branch: `cursor/scaffold-ponte-921c`

## Local loop

```bash
npx --yes "@grok/agent-sdk@0.6.0" login
npx --yes "@grok/agent-sdk@0.6.0" validate --dir .
npx --yes "@grok/agent-sdk@0.6.0" info --dir . --json
npx --yes "@grok/agent-sdk@0.6.0" tool call supported_languages --dir . --input '{"group":"indian"}'
npx --yes "@grok/agent-sdk@0.6.0" tool call submit_replacements --dir . --input '{"sourceLanguage":"en","targetLanguage":"hi","contentType":"poetry","replacements":[{"id":"s1","original":"Hello sea","translated":"समुद्र को नमस्कार"}]}'
npx --yes "@grok/agent-sdk@0.6.0" run --dir . --message "Translate to hi: [{\"id\":\"hero\",\"text\":\"The monsoon writes silver letters on the tin roof.\"}]"
npx --yes "@grok/agent-sdk@0.6.0" eval --dir . --tag smoke
npx --yes "@grok/agent-sdk@0.6.0" dev .
# Playground: http://127.0.0.1:3000/playground
```

## Framer stubs

See [`framer/README.md`](./framer/README.md):

- Code component: `framer/PonteTranslate.tsx`
- Visitor widget: `framer/ponte-visitor-widget.iife.js`
- Optional channel: `POST /v1/channels/framer/translate`

## Deploy

1. Commit and push this repo to your remote.
2. `npx --yes "@grok/agent-sdk@0.6.0" validate --dir .`
3. `npx --yes "@grok/agent-sdk@0.6.0" deploy --dir . --dry-run`
4. `npx --yes "@grok/agent-sdk@0.6.0" deploy --dir .` (save the one-time alias token)
5. Point Framer embeds at the hosted alias URL.
