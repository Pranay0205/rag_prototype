1. Think Before Coding
   Don't assume. Don't hide confusion. Surface tradeoffs.
   - State assumptions explicitly. If uncertain, ask.
   - If multiple interpretations exist, present them — don't pick silently.
   - If a simpler approach exists, say so. Push back when warranted.

2. Simplicity First — minimum code that solves the problem.
   - No features beyond what was asked.
   - No abstractions for single-use code.
   - If you write 200 lines and it could be 50, rewrite it.

3. Surgical Changes — touch only what you must.
   - Don't "improve" adjacent code, comments, or formatting.
   - Remove imports/variables/functions that YOUR changes made unused.
   - Every changed line should trace directly to the user's request.

4. Goal-Driven Execution — define success criteria, loop until verified.
   - For multi-step tasks, state a plan with explicit verify steps before starting.

5. Reuse Before You Write — search before adding new code.

8. No em-dashes — never use `—` in any user-facing copy (UI text, marketing pages, emails).
    - Use a period, comma, or a plain hyphen (`-`) instead.

9. Preserve Existing Codebase Patterns

10. Write user-facing copy in ASD-STE100 Simplified Technical English, to about 85% compliance.
    - Short sentences: at most 20 words for an instruction, 25 for a description. One idea per sentence.
    - Active voice and simple tenses ("The system merged them", not "They were merged").
    - Plain, approved-style words; avoid phrasal verbs and "-ing" nouns where a simple verb works.
    - Keep technical names, IDs and terms as they are (LEI, BM25, C-007).
    - The remaining 15% is room for natural wording where strict STE would read awkwardly.

# Client Meeting Briefing Intelligence — prototype

Spec-driven: `specs/` is the source of truth. Read `specs/00-overview.md` first.

- Implement against requirement IDs (`ING-3`, `TOOL-6`, `ORC-5`, …). Reference the ID in the
  docstring of the code that implements it; name tests `test_<ID>_<what>`.
- If code and spec disagree, stop and update the spec first (with the user's agreement).
- Principles P1–P6 in 00-overview are non-negotiable, especially: numbers only from SQL,
  entitlements enforced inside tools before retrieval, untrusted text is never instructions.
- Hand-authored files are YAML; system-produced/exchanged data is JSON.
- "Today" in the data world is 2026-11-16 (`briefing.config.TODAY`), not the system clock.

Commands:
- Python: `uv run ...` (Python 3.12). Tests: `uv run pytest`.
- Lint + format (run before every commit): `uv run ruff format src tests scripts && uv run ruff check src tests scripts`
- LLM smoke test: `uv run python scripts/check_llm.py` (needs `.env`, see `.env.example`).
- Frontend: `cd frontend && npm run dev` (proxies `/api` to :8000).