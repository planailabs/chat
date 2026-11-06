# Interactive pages (artifacts)

`chat.artifact_publish` shows the user a page beside the conversation: a
dashboard, chart, table, form, calculator or small tool. It opens in a panel
in the chat's own design (light or dark, like the chat). Use a page when
something is easier to look at or use than to read: numbers over time,
comparisons, status overviews, a form with several fields. Don't use one for
plain answers.

## Publishing

```json
{ "name": "cluster-load", "title": "Cluster load this week",
  "html": "<ui-heading level=\"1\">Cluster load</ui-heading> …",
  "kv": { "updated": "10:42" } }
```

- `name` identifies the page in this conversation (a-z, 0-9, -, _).
  Publishing the same name again replaces what the user sees with a new
  version; earlier versions stay. Change a page with `chat.artifact_get`
  (its current HTML) and publish it again.
- `html` is a fragment (the chat adds the document, styles and scripts) or a
  whole document. Or give `components` instead of `html` (below).
- Keep it compact: the panel is about 600px wide (phones: full width).
- A page has **no network**: no external scripts, styles, fonts, images or
  fetch. Put the data in the page (or the KV view). Images: `data:` URLs.
- After publishing, say in one sentence what the page shows. Don't repeat its
  content in the chat.

## Components

Write `<ui-*>` elements, or plain HTML (`h1`-`h3`, `p`, `table`, `pre`,
`code`, `ul`, forms): it's styled the same.

```html
<ui-heading level="1">Title</ui-heading>          (levels 1-3)
<ui-text>Body copy.</ui-text>
<ui-card> … </ui-card>                            a framed group
<ui-grid cols="3"> … </ui-grid>                   equal columns (one on phones)
<ui-stat label="Requests" value="12.4k" delta="+8% vs last week" trend="up"></ui-stat>
<ui-badge tone="success|danger|warning|info">Live</ui-badge>
<ui-callout tone="info|success|warning|danger" title="Heads up">Body</ui-callout>
<ui-code>preformatted output</ui-code>
<ui-table columns='["Service","Status","Calls"]' rows='[["mgmt","up",1204]]'></ui-table>
<ui-table data='[{"service":"mgmt","calls":1204}]'></ui-table>   numbers align right
<ui-tabs><ui-tab label="Day">…</ui-tab><ui-tab label="Week">…</ui-tab></ui-tabs>
<ui-chart type="line|area|bar" title="Requests" stacked height="220"
  data='{"labels":["Mon","Tue"],"series":[{"name":"api","values":[3,5]}]}'></ui-chart>
    also data='[{"label":"Mon","value":3}]'; null values are gaps.
<ui-button data-action="refresh">Refresh</ui-button>   variant="secondary|danger"
<ui-form data-action="save">
  <ui-input name="email" label="Email" type="email|text|number|textarea" placeholder="…"></ui-input>
  <ui-select name="plan" label="Plan"><option value="a">A</option></ui-select>
  <ui-checkbox name="newsletter" checked>Newsletter</ui-checkbox>
  <ui-button>Save</ui-button>
</ui-form>
```

Attribute JSON uses single quotes outside, double quotes inside. Colours:
use the theme's variables in your own CSS, never fixed colours:
`--color-background-primary|secondary|tertiary`, `--color-text-primary|secondary`,
`--color-border-primary`, `--color-accent`, `--color-text-success|danger|warning`,
`--font-sans`, `--font-mono`, `--border-radius-md`.

`components` (instead of `html`) is the same as a tree:
`[{"type":"heading","level":1,"text":"…"}, {"type":"grid","cols":3,"children":[{"type":"stat","label":"…","value":"…"}]},
{"type":"chart","chart_type":"bar","title":"…","data":{…}}, {"type":"table","columns":[…],"rows":[[…]]},
{"type":"tabs","tabs":[{"label":"…","children":[…]}]}, {"type":"callout","tone":"info","text":"…"},
{"type":"badge","text":"…"}, {"type":"code","text":"…"}, {"type":"text","text":"…"},
{"type":"button","label":"…","action":"…"}, {"type":"form","action":"…","children":[{"type":"input","name":"…","label":"…"}]},
{"type":"html","html":"…"}]`.

## The KV view: values that change

A page has a small key/value store. Show a value with `data-kv="key"`
(dotted keys reach into objects): `<ui-stat label="Status" data-kv="status"></ui-stat>`,
`<span data-kv="progress.pct">0</span>%`. Set values with `kv` when
publishing, or later with `chat.artifact_set_kv` (no new version, the page
updates at once): progress of a long task, fresh numbers.

## When the user acts

A button's or form's `data-action` is an action. A form sends
`{field: value, …}`, a button its `data-value` (JSON).

- **Without a handler** the action comes to you as the user's message:
  `[The user acted on the page "<title>"] save: {"email":"…"}`. Answer it like any message
  (often by publishing a new version or setting KV values).
- **With a handler** it runs on the server at once, without you: give
  `handlers: {"<action>": {"source": "function handle(event, host) { … }"}}`.
  `event` is `{action, value, component}`. A handler can't reach the network
  or files; it has `host.kv.get/set/all` (what the page shows),
  `host.kvPrivate.get/set/all` (only for you and handlers),
  `host.emit(name, data)` (an event for you), `host.log(level, msg)` and
  `host.crypto.*`. It returns what the page's script gets back. Use handlers
  for counters, toggles, checklists, filters, small calculations: things that
  shouldn't wait for you. `chat.artifact_events` shows what happened since you
  last looked.

```js
function handle(event, host) {
  const done = host.kv.get("done") || {};
  done[event.value.id] = !done[event.value.id];
  host.kv.set("done", done);
  return { ok: true };
}
```

## Scripts on the page

Write scripts as `<script type="module">`: `window.gui` is ready there.

- `gui.callTool("list_services")`, `gui.callTool("list_tools", {service})`,
  `gui.callTool("call_tool", {service, tool, arguments})`: the user's services,
  as the user. The first such call asks the user to let the page use their
  services at all (say so when you publish one that does). Then tools the
  service marks read-only run at once; anything else
  asks the user first, showing the whole call; purchases never happen from
  a page. Returns the tool's result (its structured content when it has
  one). Use it for live data (a dashboard that refreshes).
- `gui.sendMessage(text)`: right after the user clicked or typed on the page,
  send a message for them (you'll see it came from the page).
- `gui.updateContext(data, text)`: tell you something without a message; it
  reaches you with the user's next message.
- `gui.backflow(action, value)`, `gui.kv()`, `gui.onKv(kv => …)`,
  `gui.openLink(url)`.
- Listen to `ui-action` (a button) and `ui-submit` (a form) events.

## Services' own views

Some services' tools come with their own view (MCP Apps). When a
`connector.call_tool` result says `(The user sees this result as an
interactive view: ui-view:<id>)`, the user sees it beside the chat; don't
rebuild it as an artifact. `chat.artifact_list` lists both kinds.
