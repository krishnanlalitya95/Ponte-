# Ponte Framer embeds

Stubs for both Framer surfaces locked in the plan.

## Code component (author/editor)

- File: `PonteTranslate.tsx`
- Shared client: `ponte-client.ts`
- Drop into Framer as a code component. Set **Agent URL**, **Target lang**,
  and **Text blocks** (`id|text` per line). Click translate to call
  `POST /v1/session` and swap plain text in place.

## Visitor widget

- TypeScript source: `ponte-visitor-widget.ts`
- Browser snippet: `ponte-visitor-widget.iife.js`
- Inject on published pages. Prefers `[data-ponte-id]` nodes; otherwise
  auto-tags plain-text leaves, calls Ponte, and replaces copy in place.

```html
<script>
  window.PONTE_CONFIG = {
    baseUrl: "http://127.0.0.1:3000",
    defaultTarget: "hi",
    pageContext: "Portfolio",
  };
</script>
<script src="./ponte-visitor-widget.iife.js"></script>
```

## Agent channel

Optional fire-and-forget route (returns `202`):

`POST /v1/channels/framer/translate`

Embeds that need to apply replacements should use the session API
(`mode: "session"` in `ponte-client.ts`) and poll session events for
`submit_replacements`.
