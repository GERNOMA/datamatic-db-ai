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
2. **Chat:** select one or more groups and ask a question. The model receives a JSON schema containing only selected table names, field names/types, and descriptions when present, alongside your questions and prior generated SQL. Changing groups starts a fresh conversation.
3. The server validates the single SELECT, executes it in a read-only transaction, and displays the raw JSON rows and generated SQL. Result rows are never sent to the model.

Descriptions and groups save to this browser's local storage, separately for each database identity. Credentials stay in an HttpOnly-cookie-backed server memory session. Sessions last eight hours and are lost when the server restarts. Reconnect to refresh the schema; surviving descriptions and groups are retained.

## Plain code layout

- `app/page.tsx`: the three screens and their state, with direct fetch calls.
- `app/globals.css`: all responsive styling.
- `app/api/connect/route.ts`: connect, read the schema, restore a session, disconnect.
- `app/api/chat/route.ts`: send schema to OpenRouter, validate SQL, run it, return rows.
- `lib/database.ts`: MySQL connection and in-memory sessions.
- `lib/sql.ts`: SQL parser, table checks, and permitted SQL functions.
- `lib/types.ts`: table, field, and group types.

## Query limits and deployment

Only single SELECT statements are accepted. Cross-database references, unselected tables, comments, variables, file access, locks, and unknown functions are rejected. Basic joins, subqueries, and aggregate functions are supported; advanced SQL that the parser cannot validate is rejected. Queries get a ten-second MySQL execution limit; results stop at 500 rows or approximately 2 MB. The database account's SELECT-only grants remain the final permission boundary.

This is a local or trusted, single-server application. It deliberately has no account system or distributed session store. Do not expose it as a public service without adding access control and restrictions on database destinations. For production on one server: `npm run build` then `npm start`.

## Checks

```sh
npm run lint
npm test
npm run build
```

A live MySQL database and a funded OpenRouter key are required to verify real model-generated results. OpenRouter integration follows its [chat completions API](https://openrouter.ai/docs/quickstart).
