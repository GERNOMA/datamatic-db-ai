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

Descriptions and groups save to this browser's local storage, separately for each database identity. Credentials stay in an HttpOnly-cookie-backed server memory session. Sessions last eight hours and are lost when the server restarts. Reconnect to refresh the schema; surviving descriptions and groups are retained.

## Plain code layout

- `app/page.tsx`: the three screens and their state, with direct fetch calls.
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
