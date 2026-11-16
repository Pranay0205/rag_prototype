"""Single LLM gateway. Every model call in the system goes through here.

Provider is configured by env vars, so DeepSeek (prototype) can be swapped for an
approved, internally hosted model in production without touching callers.
"""

import json
import logging
import os
from typing import TypeVar

from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel, ValidationError

load_dotenv()
log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

_client = OpenAI(
    api_key=os.environ.get("LLM_API_KEY", "missing"),
    base_url=os.environ.get("LLM_BASE_URL", "https://api.deepseek.com"),
)
MODEL = os.environ.get("LLM_MODEL", "deepseek-chat")

usage = {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0}


class LLMError(RuntimeError):
    pass


def chat_json(system: str, user: str, schema: type[T], *, retries: int = 1, temperature: float = 0.0) -> T:
    """Call the model in JSON mode and validate the reply against `schema`.

    On invalid output, the validation error is fed back once so the model can repair it.
    Raises LLMError rather than returning partial or unvalidated data.
    """
    messages = [
        {"role": "system", "content": f"{system}\n\nReply with JSON only, matching this schema:\n{json.dumps(schema.model_json_schema())}"},
        {"role": "user", "content": user},
    ]
    for attempt in range(retries + 1):
        resp = _client.chat.completions.create(
            model=MODEL,
            messages=messages,
            response_format={"type": "json_object"},
            temperature=temperature,
        )
        usage["calls"] += 1
        if resp.usage:
            usage["prompt_tokens"] += resp.usage.prompt_tokens
            usage["completion_tokens"] += resp.usage.completion_tokens
        content = resp.choices[0].message.content or ""
        try:
            return schema.model_validate_json(content)
        except ValidationError as e:
            log.warning("LLM output failed validation (attempt %d): %s", attempt + 1, e)
            messages += [
                {"role": "assistant", "content": content},
                {"role": "user", "content": f"Your JSON was invalid: {e}. Return corrected JSON only."},
            ]
    raise LLMError(f"Model output did not match {schema.__name__} after {retries + 1} attempts")
