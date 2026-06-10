# HGV UI

Standalone test UI for MOTIS HGV routing support.

This project intentionally vendors the MOTIS OpenAPI spec and generated API client so it can target pre-release MOTIS builds before the public `@motis-project/motis-client` package contains the HGV/vehicle fields.

## Structure

- `openapi.yaml`: copied MOTIS API spec used by this test UI.
- `api/`: local `@motis-project/motis-client` package generated from `openapi.yaml`.
- `src/`: UI.

## Development

Install dependencies:

```bash
pnpm install
```

Regenerate the local API client after updating `openapi.yaml`:

```bash
pnpm update-api
```

Build the API client and UI:

```bash
pnpm build
```

Run the dev server:

```bash
pnpm dev
```

Open the dev URL with a `motis` query parameter pointing at the backend you want to test, for example:

```text
http://localhost:5173/?motis=http://localhost:8080
```

If Vite uses a different port, keep that port in the browser URL and only change the `motis` value. Without this parameter, the UI uses the current origin as the MOTIS API base URL, which usually only works when the UI is served by the MOTIS backend itself.

## Map

Click the bug icon and zoom in to enable the debug overlay.

- Ways with HGV specific attributes are shown in blue.
- Ways with conditional restrictions have a yellow glow.
- Ways that have hazmat restrictions are shown with a small hazmat icon.

Click on ways to show their properties.

For routing, the A (from) / B (to) pins can be dragged.
