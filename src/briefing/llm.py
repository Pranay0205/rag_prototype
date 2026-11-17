"""Single LLM gateway. Every model call in the system goes through here.

Provider is configured by env vars (OpenRouter for the prototype, any OpenAI-compatible
endpoint works), so it can be swapped for an approved, internally hosted model in
production without touching callers.

Two tiers:
  - strong: briefing generation and claim verification (quality-critical)
  - fast:   entity-link tie-breaks, commitment extraction, eval judging (high volume)
"""

import json
import logging
import os
import re

from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel, ValidationError

load_dotenv()
log = logging.getLogger(__name__)


BASE_URL = os.environ.get("LLM_BASE_URL", "https://openrouter.ai/api/v1")
_IS_OPENROUTER = "openrouter.ai" in BASE_URL
# Model slugs from https://openrouter.ai/models (verified available 2026-11-16).
MODEL = os.environ.get("LLM_MODEL") or "anthropic/claude-sonnet-5.5"
MODEL_FAST = os.environ.get("LLM_MODEL_FAST") or "anthropic/claude-haiku-5.5"
# EVAL-5 grader. A different model (or mode) from the writer, so the eval does not share the
# writer's blind spots; speed does not matter offline.
MODEL_EVAL = os.environ.get("LLM_MODEL_EVAL") or MODEL_FAST
# OPENROUTER_API_KEY is the standard name; LLM_API_KEY covers non-OpenRouter endpoints.
API_KEY = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("LLM_API_KEY")

_client = OpenAI(api_key=API_KEY or "unset", base_url=BASE_URL, max_retries=2, timeout=90)

# Running totals, surfaced in the API/eval report (cost per briefing is a platform metric).
usage = {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "cost_usd": 0.0}

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


class LLMError(RuntimeError):
    pass


def chat_json[T: BaseModel](
    system: str,
    user: str,
    schema: type[T],
    *,
    fast: bool = False,
    retries: int = 1,
    temperature: float = 0.0,
    model: str | None = None,
) -> T:
    """Call the model in JSON mode and validate the reply against `schema`.

    On invalid output, the validation error is fed back once so the model can repair it.
    Raises LLMError rather than returning partial or unvalidated data.
    """
    if not API_KEY:
        raise LLMError(
            "OPENROUTER_API_KEY is not set. Create a key at https://openrouter.ai/keys "
            "and put it in .env (see .env.example)."
        )
    model = model or (MODEL_FAST if fast else MODEL)
    messages = [
        {
            "role": "system",
            "content": f"{system}\n\nReply with a single JSON object only, matching this schema:\n"
            f"{json.dumps(schema.model_json_schema())}",
        },
        {"role": "user", "content": user},
    ]
    extra = {"usage": {"include": True}} if _IS_OPENROUTER else None  # ask OpenRouter for per-call cost

    for attempt in range(retries + 1):
        try:
            resp = _client.chat.completions.create(
                model=model,
                messages=messages,
                response_format={"type": "json_object"},
                temperature=temperature,
                extra_body=extra,
            )
        except Exception as e:  # network, auth, rate limit: surface as one error type
            raise LLMError(f"LLM call to {model} failed: {e}") from e

        _record_usage(resp)
        content = _FENCE.sub("", resp.choices[0].message.content or "")
        try:
            return schema.model_validate_json(content)
        except ValidationError as e:
            log.warning("LLM output failed validation (attempt %d, %s): %s", attempt + 1, model, e)
            messages += [
                {"role": "assistant", "content": content},
                {"role": "user", "content": f"Your JSON was invalid: {e}. Return corrected JSON only."},
            ]
    raise LLMError(f"{model} output did not match {schema.__name__} after {retries + 1} attempts")


def _record_usage(resp) -> None:
    usage["calls"] += 1
    if resp.usage:
        usage["prompt_tokens"] += resp.usage.prompt_tokens or 0
        usage["completion_tokens"] += resp.usage.completion_tokens or 0
        cost = (resp.usage.model_extra or {}).get("cost")
        if isinstance(cost, (int, float)):
            usage["cost_usd"] += cost
