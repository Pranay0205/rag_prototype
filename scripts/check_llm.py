"""Smoke test: one tiny JSON request to each configured model, end to end.

Run: uv run python scripts/check_llm.py
"""

import sys

from pydantic import BaseModel

from briefing import llm


class Pong(BaseModel):
    ok: bool
    model_said: str


def main() -> int:
    for fast in (False, True):
        name = llm.MODEL_FAST if fast else llm.MODEL
        try:
            r = llm.chat_json(
                "You are a connectivity check.",
                'Return {"ok": true, "model_said": "<one word greeting>"}',
                Pong,
                fast=fast,
            )
        except llm.LLMError as e:
            print(f"FAIL {'fast  ' if fast else 'strong'} {name}: {e}", file=sys.stderr)
            return 1
        print(f"OK   {'fast  ' if fast else 'strong'} {name}: {r.model_dump()}")
    u = llm.usage
    print(
        f"calls={u['calls']} tokens={u['prompt_tokens']}+{u['completion_tokens']} cost=${u['cost_usd']:.5f}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
