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

The first discovery is mandatory once per conversation, including when it finds no matches. Later discoveries are optional and can be interleaved with SQL actions or requested for a follow-up question. They reassess every table and add matches to the existing context. The context is held on the server for the current session; new conversations and reconnections start fresh. There are up to five discovery sweeps plus five SQL queries per question. Every table's JEV request starts in parallel under the existing three-minute deadline. A sweep tolerates failed requests when they account for at most 10% of its candidates; above that limit it fails without replacing the previous context or automatically retrying requests.

JEV uses the same OpenRouter key through the [Decisions API](https://github.com/OpenRouterTeam/typescript-sdk/blob/main/src/funcs/alphaDecisionsCreate.ts), at `/api/alpha/decisions`, with model `typesafe/jev-1.13` and a `noul` yes/no probability. The main model remains the model configured in Connect. Free visualization works with either context mode.

## Modelos, Controladores y Más

Open **Modelos, Controladores y Más** in the navigation (or `/modelos`). Select a ZIP, an entire folder including subfolders, or multiple PHP files. Analysis runs locally in a cancellable browser worker, without executing PHP or sending source code to an AI service. Limits: 20,000 PHP files and 100 MB of uncompressed source per analysis.

Download a ZIP with three JSON files per detected Yii2 ActiveRecord class: `sin-codigo/` contains the logical table (`module`), model identity, referenced functions, controller or owning class, source path, line, and matching evidence; `con-codigo/` adds the exact method declaration (`rawCode`) and text inside its braces (`body`); `simplificado/` keeps only `name` and `file` per function. Non-controller functions have `controller: null`. The archive includes `informe.json` with parsing failures and missing base classes. Separate models sharing a table retain separate exports.

The page is the rightmost tab in the existing application. At the bottom, upload the generated ZIP to review table usage against the connected database. **Aplicar revisión** marks tables **NOT USED** when they are absent from the ZIP or have no functions owned by another class (global functions count as external use). For shared tables, external use in any exported model counts as use. Matching uses exact table names; unresolved names and prefix mismatches are reported. Older ZIPs without `simplificado/` are supported by deriving the simple data from `sin-codigo/`.

The **NOT USED** checkbox in Base de Datos can mark or re-enable any table. Flags persist per connection in the browser workspace, across reconnects and workspace JSON exports/imports. Excluded tables are removed from chat context, JEV discovery, SQL allowlists, and labeling. Changing the flags clears the current conversation. Imports preserve existing exclusions until manually unchecked.

After applying the review, **Automatic labeling** uses the selected OpenRouter writing model and the connection's existing API key. Up to 50 tables are investigated concurrently. Small code sets (at most eight functions and 12 KB including metadata) go directly to the writer, avoiding an initial JEV selection pass. For larger sets, JEV evaluates full linked functions from the saved code archive for row meaning, lifecycle, business purpose, relationships and unclear field meanings. A diverse selection of code is shown to the writer alongside the actual schema. The writer can inspect specific linked functions, request one additional targeted JEV search, inspect related active schemas, and attempt up to three SELECT queries. A mandatory JEV review checks the draft and explicit claims for contradictions, omissions and unresolved questions. A validated draft is saved directly when every function was inspected, every review score is at most 0.1, and there are no review failures, missing-evidence warnings, unresolved uncertainties or SQL results. Otherwise the writer receives the review and finalizes a short Spanish description (maximum 240 characters). This removes the redundant second writer call only on the clean path; a low score is still not proof of correctness.

Automatic labeling also evaluates field names in context. When an abbreviation, flag, code or other name is unclear and the inspected code/schema/SELECT evidence establishes its meaning, the writer proposes a Spanish field description of up to 240 characters with an ambiguity explanation and source references. These proposals are included in the draft reviewed by JEV. Only blank field descriptions are filled; existing descriptions, clear names, and fields whose meaning remains unsupported are left unchanged. Field descriptions use the same investigation budgets and persist with the workspace. Their proposals and sources appear in the table’s evidence panel.

Save the `con-codigo/` archive under **Archivo guardado en la web** to enable code investigation. Without linked code, labeling still uses schemas and SELECTs and records that limitation. Starting labeling sends schema, linked code and query results to OpenRouter. PHP is never executed. SELECTs use the same SQL validation, read-only transactions, ten-second execution limit and 500-row/100-KB result limits as chat; joins require inspected active tables. Excluded tables cannot be inspected or queried.

Each table has at most eight writer calls, three JEV sweeps and three minutes; the overall batch has a thirty-minute deadline. JEV checks are batched into requests of up to eight functions, with a 24-KB target for function payloads; larger individual functions travel alone. Every function receives independent answers to each criterion, while schema and criteria are shared once per request. Up to eight batches run concurrently per active table. Code sent to the writer is limited to 120 KB, and individual functions over 100 KB are skipped by JEV. Missing code, failed JEV decisions and incomplete evidence are recorded as warnings; JEV scores are selection signals, not verified facts. A bounded, connection-scoped in-memory cache reuses batch decisions for identical code, schema and questions; changed inputs are reevaluated. Query results are never cached. The writer is instructed to draft from sufficient evidence immediately and request tools only for material uncertainty, combining related SQL checks where practical. In a mocked 32-small-function example, two sweeps take eight JEV requests instead of 64; a clean small-code table takes one writer call and one JEV review request instead of two writer calls plus per-function scouting/review requests. Actual monetary savings depend on provider billing, token usage, cache hits and how much investigation a table needs.

Only valid, reviewed descriptions replace existing text. The workspace also saves the final claims, inspected function references and code hashes, SQL statements and result counts, and uncertainties; SQL rows and full code are not included in that evidence record. Expand **Ver evidencia de la descripción** under a table's description to inspect it. Evidence survives reconnects and JSON exports/imports; manually editing a description clears its old evidence. Progress, cancellation and failed-only retry are supported, and completed descriptions survive partial failures. No requests run until the user starts labeling.

Detection follows included ActiveRecord inheritance, PHP namespaces and aliases, class references, and calls to included static or `$this` methods (including inherited helpers such as `findModel`). Include custom base classes with your project. Table names are explicit, inherited, convention-based, or unresolved; dynamic `tableName()` expressions are preserved without inventing a table. Yii connection prefixes are not resolved. Form models without tables are excluded. This is static context extraction for use with an AI, not a complete runtime call graph: dynamic dispatch, reflection, raw SQL, trait methods and some variable flows are not resolved. Results stay in memory until you leave or reload the page.

## Plain code layout

### Saved code and function discovery

In **Modelos, Controladores y Más → Archivo guardado en la web**, upload a `.rar` or `.zip` containing the exported `con-codigo/` JSONs. RAR decoding uses [node-unrar-js](https://github.com/YuJianrong/node-unrar.js). The original archive and validated functions are saved per database connection in `.datamatic/code/` on the server. Keep this directory on persistent storage when deploying; it is excluded from Git and browser workspace exports. Uploading raw PHP here is not supported: analyze it first using the existing project analyzer. A failed upload leaves the previous archive intact.

The main model may choose `discover_functions` with a specific behavior to investigate. JEV receives one parallel request per unique function linked to the tables currently in chat context, including its complete original code. Only probabilities strictly above `JEV_FUNCTION_THRESHOLD` in `lib/code-context.ts` (default `0.6`) pass. This setting is code-only, with no user-facing control. The main model receives matching code only; discovery supports both manual groups and DR.STRANGE, and has its own five-search budget per question. A sweep tolerates failed requests when they account for at most 10% of its candidates; above that limit it fails without automatically retrying all requests.

The context sidebar shows selected functions, file/line, owning class, models, search purpose, and expandable complete code. Selected code accumulates across follow-up messages in the same chat, including after an answer fails. Replacing the archive affects future discoveries but preserves code already shown in that chat. A new/reset conversation, reconnection, session expiration, or server restart clears chat context; saved archives survive restarts. Functions tied only to excluded tables are removed. Unresolved table names cannot be searched until their model mapping is corrected.

- `app/page.tsx`: the main screens and their state, with direct fetch calls.
- `app/modelos/models-page.tsx`: recursive Yii2 project upload, results and JSON downloads.
- `app/modelos/usage-import.tsx`: usage review, exclusions and automatic labeling.
- `app/api/labels/route.ts`: bounded research batches with streamed progress and results.
- `lib/researched-labels.ts`: JEV evidence selection, draft review, writer tools and evidence records.
- `lib/query.ts`: shared bounded, read-only SQL executor for chat and labeling.
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
