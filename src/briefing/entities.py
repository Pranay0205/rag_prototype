"""ING-3 entity resolution: map a company name string to a client_id.

Deterministic, no LLM:
  1. exact (case/punctuation-insensitive) match on alias, legal name or short name -> 1.0
  2. fuzzy token_set_ratio >= 90, unless the query has a distinguishing token that none of the
     client's names contain (e.g. "Systems" vs "Partners") -> rejected
"""

import re
import sqlite3
from dataclasses import dataclass

from rapidfuzz import fuzz

LEGAL_SUFFIXES = {"inc", "incorporated", "plc", "llc", "ltd", "limited", "corp", "corporation", "co", "lp", "sa", "ag", "nv", "bv"}
# Words that do not distinguish one company from another; extra occurrences are tolerated.
GENERIC_WORDS = {"holdings", "holding", "group", "company", "the", "international", "global", "and", "of"}
FUZZY_THRESHOLD = 90
FUZZY_MAX_CONFIDENCE = 0.95  # a fuzzy match is never as certain as an exact one
MIN_FUZZY_LEN = 4  # short strings like "CHP" only match exactly


def normalize(name: str) -> str:
    tokens = re.sub(r"[^a-z0-9 ]", " ", name.lower()).split()
    return " ".join(t for t in tokens if t not in LEGAL_SUFFIXES)


@dataclass(frozen=True)
class Match:
    client_id: str
    confidence: float
    method: str  # "exact" | "fuzzy"
    matched_name: str


class EntityResolver:
    def __init__(self, names_by_client: dict[str, set[str]]):
        # names_by_client: client_id -> raw names (legal, short, aliases), already merge-mapped
        self.names = {cid: {normalize(n) for n in names if normalize(n)} for cid, names in names_by_client.items()}
        self.tokens = {cid: {t for n in ns for t in n.split()} for cid, ns in self.names.items()}

    @classmethod
    def from_db(cls, conn: sqlite3.Connection) -> "EntityResolver":
        names: dict[str, set[str]] = {}
        for r in conn.execute("SELECT client_id, legal_name, short_name FROM clients"):
            names.setdefault(r["client_id"], set()).update({r["legal_name"], r["short_name"]})
        for r in conn.execute("SELECT client_id, alias FROM client_aliases"):
            names.setdefault(r["client_id"], set()).add(r["alias"])
        return cls(names)

    def resolve(self, query: str) -> list[Match]:
        """All plausible matches, best first. Empty list = unresolved."""
        q = normalize(query)
        if not q:
            return []
        exact = [Match(cid, 1.0, "exact", n) for cid, ns in self.names.items() for n in ns if n == q]
        if exact:
            return _best_per_client(exact)
        if len(q) < MIN_FUZZY_LEN:
            return []
        q_tokens = set(q.split())
        fuzzy = []
        for cid, ns in self.names.items():
            distinguishing = q_tokens - self.tokens[cid] - GENERIC_WORDS
            if distinguishing:
                continue  # e.g. "systems" never appears in Cascade Health Partners' names
            for n in ns:
                if len(n) < MIN_FUZZY_LEN:
                    continue
                score = fuzz.token_set_ratio(q, n)
                if score >= FUZZY_THRESHOLD:
                    fuzzy.append(Match(cid, min(FUZZY_MAX_CONFIDENCE, score / 100), "fuzzy", n))
        return _best_per_client(fuzzy)


def _best_per_client(matches: list[Match]) -> list[Match]:
    best: dict[str, Match] = {}
    for m in matches:
        if m.client_id not in best or m.confidence > best[m.client_id].confidence:
            best[m.client_id] = m
    return sorted(best.values(), key=lambda m: -m.confidence)
