"""ORC-6 step 2: deterministic number check.

Every quantity in a claim (money, %, bps, multiples, capacity) must appear in its cited
evidence. "$3.4M" in a claim matches "$3,400,000" in evidence because both normalize to
3,400,000 and the evidence value, rounded half-up to the claim's precision, equals the claim.

Bare numbers (dates, years, counts like "five banks") are not checked in v1; the
entailment check (step 3) covers them.
"""

import re
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from rapidfuzz import fuzz

_QUANTITY = re.compile(
    r"""
    (?<![\w.])                                         # not inside a word or another number
    (?P<cur>\$|€|£|USD\s?|EUR\s?|GBP\s?)?              # optional currency before the number
    (?P<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)
    \s?
    (?P<unit>%|percent\b|bps\b|basis\spoints\b|x\b|mn\b|bn\b|million\b|billion\b|thousand\b|
             [MBK]\b|GW\b|MW\b)?
    """,
    re.VERBOSE | re.IGNORECASE,
)
_SCALE = {"k": 1e3, "thousand": 1e3, "m": 1e6, "mn": 1e6, "million": 1e6, "b": 1e9, "bn": 1e9, "billion": 1e9}
_CURRENCY = {"$": "USD", "usd": "USD", "€": "EUR", "eur": "EUR", "£": "GBP", "gbp": "GBP"}


@dataclass(frozen=True)
class Quantity:
    kind: str  # "money" | "pct" | "bps" | "multiple" | "power_mw"
    currency: str | None  # money only; None = not stated
    value: Decimal  # normalized, e.g. 3400000 for "$3.4M"; always non-negative
    scale: Decimal  # multiplier the claim was written in (1e6 for "M"), used for rounding
    decimals: int  # digits after the point as written ("3.4" -> 1)
    text: str


def extract_quantities(text: str) -> list[Quantity]:
    out = []
    for m in _QUANTITY.finditer(text):
        cur = (m["cur"] or "").strip().lower()
        unit = (m["unit"] or "").strip().lower()
        if not cur and not unit:
            continue  # bare number: date, year, count
        raw = m["num"].replace(",", "")
        decimals = len(raw.split(".")[1]) if "." in raw else 0
        number = Decimal(raw)
        if unit in ("%", "percent"):
            kind, scale = "pct", Decimal(1)
        elif unit in ("bps", "basis points"):
            kind, scale = "bps", Decimal(1)
        elif unit == "x":
            kind, scale = "multiple", Decimal(1)
        elif unit in ("gw", "mw"):
            kind, scale = "power_mw", Decimal(1000 if unit == "gw" else 1)
        else:
            kind, scale = "money", Decimal(str(_SCALE.get(unit, 1)))
        out.append(
            Quantity(kind, _CURRENCY.get(cur), abs(number * scale), scale, decimals, m.group().strip())
        )
    return out


def _matches(claim: Quantity, evidence: Quantity) -> bool:
    if claim.kind != evidence.kind:
        return False
    if claim.currency and evidence.currency and claim.currency != evidence.currency:
        return False
    # Round the evidence value, expressed in the claim's scale, half-up to the claim's precision.
    step = Decimal(1).scaleb(-claim.decimals)
    rounded = (evidence.value / claim.scale).quantize(step, rounding=ROUND_HALF_UP)
    return rounded == (claim.value / claim.scale).quantize(step)


def unsupported_numbers(claim_text: str, evidence_texts: list[str]) -> list[str]:
    """Quantities in the claim that no cited evidence supports. Empty list = check passed."""
    evidence = [q for t in evidence_texts for q in extract_quantities(t)]
    return [c.text for c in extract_quantities(claim_text) if not any(_matches(c, e) for e in evidence)]


# Rule (b): claims about OUR relationship metrics must be backed by structured (sql) evidence.
# Deliberately narrow: bare "revenue" would catch the client's own revenue guidance.
_RELATIONSHIP_METRIC = re.compile(
    r"\b(relationship revenue|(fx|lending|cash management|dcm|custody) revenue|ttm|trailing[- ]twelve|yoy|"
    r"year[- ](on|over)[- ]year|wallet|utili[sz])",
    re.IGNORECASE,
)


def check_numbers(claim_text: str, cited: list[dict], allow_derived: bool = False) -> list[str]:
    """ORC-6 step 2 with rules (a) and (b). `cited` items have keys: kind ("sql"|"document"),
    derived (bool), text. allow_derived=True only for the Uncertainty section, whose claims
    describe stale values. Returns the unsupported quantities (empty = pass)."""
    usable = cited if allow_derived else [e for e in cited if not e.get("derived")]  # (a)
    if _RELATIONSHIP_METRIC.search(claim_text):
        # (b) sql only; in the Uncertainty section a prior briefing may back the stale value it states
        usable = [e for e in usable if e["kind"] == "sql" or (allow_derived and e.get("derived"))]
    return unsupported_numbers(claim_text, [e["text"] for e in usable])


# ORC-6: locating the model's supporting quote inside the real evidence text.
_SENTENCE = re.compile(r"(?<=[.!?;])\s+|\n+")
QUOTE_FUZZY_THRESHOLD = 90


def locate_quote(quote: str, evidence_text: str) -> str | None:
    """Return the span of `evidence_text` that the model's quote refers to, or None.

    The returned text always comes from the evidence, never from the model:
      1. exact match (whitespace-insensitive) -> that span of the evidence
      2. otherwise the evidence sentence that best matches (rapidfuzz ratio >= 90), which
         tolerates small copying slips such as changed punctuation
    """
    q = " ".join(quote.split())
    if not q:
        return None
    flat = " ".join(evidence_text.split())
    start = flat.lower().find(q.lower())
    if start >= 0:
        return flat[start : start + len(q)]
    sentences = [s.strip() for s in _SENTENCE.split(flat) if s.strip()]
    best = max(sentences, key=lambda s: fuzz.ratio(q.lower(), s.lower()), default=None)
    if best and fuzz.ratio(q.lower(), best.lower()) >= QUOTE_FUZZY_THRESHOLD:
        return best
    return None
