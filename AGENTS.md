# Repository Guidelines

## Project Structure & Module Organization
This repository is a local-first network diagnostics workspace with a VSCode-style UI.

- `apps/web/`: React + TypeScript frontend (left command panel, right output/analysis panel).
- `apps/server/`: Node.js + TypeScript backend (whitelisted command execution, SSE streaming, parsers).
- `docs/`: architecture and design notes.
- `README.md`: quick start and usage overview.

Keep UI concerns in `apps/web` and diagnostic execution/parsing in `apps/server`.

## Build, Test, and Development Commands
Run commands from repository root:

- `npm install`: install workspace dependencies.
- `npm run dev`: start backend (`:8787`) and frontend (`:5173`) together.
- `npm run dev:server`: run only backend.
- `npm run dev:web`: run only frontend.
- `npm run build`: build both workspaces.
- `npm run lint`: TypeScript type-check for both apps.
- `npm run test`: placeholder test scripts (expand as tests are added).

## Coding Style & Naming Conventions
- Use 2-space indentation in TypeScript.
- React components: `PascalCase` (e.g., `App.tsx`); utilities and variables: `camelCase`.
- Backend modules use descriptive file names (`job-manager.ts`, `parsers.ts`, `definitions.ts`).
- Keep command execution restricted to `definitions.ts`; do not execute arbitrary shell input.

## Testing Guidelines
- Add tests alongside source as `*.test.ts` / `*.test.tsx`.
- Prioritize parser, rule-evaluator, and API contract tests.
- For command execution changes, validate timeout/error handling and stream completion behavior.
- Keep tests deterministic; avoid depending on unstable public endpoints where possible.

## Commit & Pull Request Guidelines
No stable Git history exists yet; use Conventional Commits going forward:

- `feat: add packet-loss diagnosis rule`
- `fix: prevent duplicate complete events`

PRs should include scope summary, test evidence (or manual verification notes), linked issue, and screenshots/GIFs for UI updates.

## Security & Configuration Tips
- Allowlist executable commands only; never concatenate raw user input into shell commands.
- Sanitize and validate targets on API boundaries.
- Avoid storing sensitive IP/domain data in long-term logs unless explicitly required.
