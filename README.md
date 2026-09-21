# Datamatic

A small Next.js app for asking questions about a MySQL database through OpenRouter.

## Run

```sh
npm install
npm run dev
```

Open http://localhost:3000. In **Connect**, enter a MySQL URL, an OpenRouter API key, and a model ID (defaults to `openrouter/auto`). Use a database account granted only SELECT on the database you want to explore. MySQL 8 is recommended. For verified TLS, append `?ssl=true` to the URL. URL-encode special characters in usernames and passwords.

Alternatively, set `OPENROUTER_API_KEY` and optionally `OPENROUTER_MODEL` in `.env.local` before starting the app. The form's nonempty values take precedence.

1. **Database:** select a table and describe it and its fields. Create groups such as Workers containing workers, company, and workers_route. Edit or delete groups by clicking their names.
2. **Chat:** select one or more groups and ask a question. The model receives a JSON schema containing only selected table names, field names/types, and descriptions when present, alongside your questions and prior answers and SQL. Changing groups starts a fresh conversation.
3. The AI can run up to five SELECT queries, receiving the rows or error after each step before deciding whether to query again. The server validates every query and runs it in a read-only transaction. Query results are sent to OpenRouter and the selected model. The final answer uses a small declarative view description rendered by React as tables, metrics, or optionally animated bar charts. By default, generated JavaScript is never executed. Enable **Free visualization** beside Send to let the AI write its own HTML, CSS, and JavaScript mini webpage. It runs inside a [sandboxed iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox) with scripts enabled but without same-origin access, top-level navigation, popups, or form submission. Its content policy blocks external scripts, resource loads, and fetch requests. Actual query steps are injected as `window.queryResults`. The preview can be resized vertically; its source is available under **View visualization code**. SQL steps remain available in a collapsed detail panel.

The browser saves one versioned JSON workspace (`datamatic:workspace`) containing all connection profiles (MySQL URLs and explicitly entered API keys included), models, schemas, table/field descriptions, groups, selected groups, and the free-visualization preference. Existing per-database description/group saves migrate automatically. Old saves have no credentials; reconnect once to complete their profiles. Server-provided API keys are never copied into the workspace.

At the bottom of **Connect**, **Exportar JSON** downloads `datamatic-workspace.json`. **Importar JSON** validates a version-1 workspace (up to 5 MB) and replaces the entire saved workspace, including all connections. Invalid files leave the current workspace intact. Import ends the current server session and clears the conversation; choose a saved connection and connect to refresh its schema while retaining surviving descriptions and groups. The exported JSON contains credentials in plain text. Chat results and unsaved form/editor drafts are not included. Server sessions last eight hours or until a restart; saved profiles remain available to reconnect.

## Modo DR.STRANGE

Enable **Modo DR.STRANGE**, to the left of **Visualización libre**, to replace manual group selection with automatic table discovery. Switching this mode starts a new conversation. The main model first chooses a purpose; JEV receives one request per table in the connected schema, including its field and table descriptions. Only tables with a probability of usefulness strictly above 60% become visible and queryable by the main model. Change `JEV_CONFIDENCE_THRESHOLD` in `lib/jev.ts` (0–1) to adjust that cutoff.

The first discovery is mandatory once per conversation, including when it finds no matches. Later discoveries are optional and can be interleaved with SQL actions or requested for a follow-up question. They reassess every table and add matches to the existing context. The context is held on the server for the current session; new conversations and reconnections start fresh. There are up to five discovery sweeps plus five SQL queries per question. Every table's JEV request starts in parallel under the existing three-minute deadline. Failed sweeps do not replace the previous context or automatically retry requests.

JEV uses the same OpenRouter key through the [Decisions API](https://github.com/OpenRouterTeam/typescript-sdk/blob/main/src/funcs/alphaDecisionsCreate.ts), at `/api/alpha/decisions`, with model `typesafe/jev-1.13` and a `noul` yes/no probability. The main model remains the model configured in Connect. Free visualization works with either context mode.

## Modelos, Controladores y Más

Open **Modelos, Controladores y Más** in the navigation (or `/modelos`). Select a ZIP, an entire folder including subfolders, or multiple PHP files. Analysis runs locally in a cancellable browser worker, without executing PHP or sending source code to an AI service. Limits: 20,000 PHP files and 100 MB of uncompressed source per analysis.

Download a ZIP with one JSON pair per detected Yii2 ActiveRecord class: `sin-codigo/` contains the logical table (`module`), model identity, referenced functions, controller or owning class, source path, line, and matching evidence; `con-codigo/` adds the exact method declaration (`rawCode`) and text inside its braces (`body`). Non-controller functions have `controller: null`. The archive includes `informe.json` with parsing failures and missing base classes. Separate models sharing a table retain separate exports.

Detection follows included ActiveRecord inheritance, PHP namespaces and aliases, class references, and calls to included static or `$this` methods (including inherited helpers such as `findModel`). Include custom base classes with your project. Table names are explicit, inherited, convention-based, or unresolved; dynamic `tableName()` expressions are preserved without inventing a table. Yii connection prefixes are not resolved. Form models without tables are excluded. This is static context extraction for use with an AI, not a complete runtime call graph: dynamic dispatch, reflection, raw SQL, trait methods and some variable flows are not resolved. Results stay in memory until you leave or reload the page.

## Plain code layout

- `app/page.tsx`: the main screens and their state, with direct fetch calls.
- `app/modelos/page.tsx`: recursive Yii2 project upload, results and JSON downloads.
- `app/modelos/yii.worker.ts`: background parsing and ZIP generation.
- `lib/yii-analysis.ts`: model discovery, table resolution and function mapping.
- `app/globals.css`: all responsive styling.
- `app/api/connect/route.ts`: connect, read the schema, restore a session, disconnect.
- `app/api/chat/route.ts`: call OpenRouter and execute bounded, read-only queries.
- `lib/chat.ts`: the query/answer loop and small view format validation.
- `app/answer-view.tsx`: render the AI-selected views or the isolated mini webpage.
- `lib/visualization.ts`: prepare the preview document and safely embed query data.
- `lib/database.ts`: MySQL connection and in-memory sessions.
- `lib/sql.ts`: SQL parser, table checks, and permitted SQL functions.
- `lib/types.ts`: table, field, and group types.

## Query limits and deployment

Only single SELECT statements are accepted. Cross-database references, unselected tables, comments, variables, file access, locks, and unknown functions are rejected. Basic joins, subqueries, and aggregate functions are supported; advanced SQL that the parser cannot validate is rejected. Queries get a ten-second MySQL execution limit; results stop at 500 rows or 100 KB per step. Each question allows five queries, up to eight model calls (including format corrections), and a three-minute overall deadline checked between steps and during model requests. A query already running may take its remaining ten-second SQL limit. Truncated data is marked in the answer. The model can answer without querying when no database lookup is needed. The database account's SELECT-only grants remain the final permission boundary.

This is a local or trusted, single-server application. It deliberately has no account system or distributed session store. Do not expose it as a public service without adding access control and restrictions on database destinations. For production on one server: `npm run build` then `npm start`.

## Checks

```sh
npm run lint
npm test
npm run build
```

A live MySQL database and a funded OpenRouter key are required to verify real model-generated results. OpenRouter integration follows its [chat completions API](https://openrouter.ai/docs/quickstart).
