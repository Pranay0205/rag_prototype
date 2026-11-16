"""ORC-6 step 2: number check. Named test_<REQ-ID>_<what>."""

from decimal import Decimal

from briefing.verify import check_numbers, extract_quantities, unsupported_numbers

# The real revenue summary evidence produced by get_revenue (TOOL-6)
E1 = (
    "Relationship revenue TTM 2025Q4-2026Q3: $3,400,000; prior TTM 2024Q4-2025Q3: $4,150,000; "
    "YoY -18.1%. By product line: FX: $900,000 vs $1,600,000 (-43.8%)"
)


def test_ORC_6_normalizes_short_money():
    q = extract_quantities("$3.4M")[0]
    assert (q.kind, q.currency, q.value) == ("money", "USD", Decimal("3400000"))


def test_ORC_6_short_form_matches_full_number():
    assert unsupported_numbers("Revenue fell to $3.4M.", [E1]) == []


def test_ORC_6_rounded_percent_and_sign_in_words():
    assert unsupported_numbers("Revenue fell 18% year on year.", [E1]) == []
    assert unsupported_numbers("Revenue fell 18.1%.", [E1]) == []


def test_ORC_6_wrong_number_flagged():
    # $4,150,000 rounds half-up to $4.2M, so the stale briefing's "$4.1M" is not supported (T4)
    assert unsupported_numbers("Revenue is about $4.1M.", [E1]) == ["$4.1M"]
    assert unsupported_numbers("FX revenue fell 50%.", [E1]) == ["50%"]


def test_ORC_6_currency_must_agree():
    assert unsupported_numbers("A EUR 900,000 decline.", [E1]) == ["EUR 900,000"]
    assert (
        unsupported_numbers("Acquisition for EUR 310 million.", ["agreed to acquire ... for EUR 310 million"])
        == []
    )


def test_ORC_6_units_bps_multiples_capacity():
    assert unsupported_numbers("Asking for 15 bps tighter margin.", ["offers 15 basis points tighter"]) == []
    assert unsupported_numbers("Leverage rose to 2.6x.", ["net leverage 2.6x"]) == []
    assert unsupported_numbers("A 1.2 GW portfolio.", ["1,200 MW of onshore wind"]) == []


def test_ORC_6_bare_numbers_ignored():
    # dates, years, quarters and counts are left to the entailment check
    assert extract_quantities("Due 15 October 2026 for Q1 2027; five banks, 3 sites.") == []


SQL_E1 = {"kind": "sql", "derived": False, "text": E1}
STALE_BRIEFING = {
    "kind": "document",
    "derived": True,
    "text": "Relationship revenue is approximately $4.1M and growing.",
}
EMAIL = {
    "kind": "document",
    "derived": False,
    "text": "roughly EUR 200 million of annual euro-denominated costs",
}
CHATTY_EMAIL = {"kind": "document", "derived": False, "text": "our revenue with you is about $3.4M"}


def test_ORC_6_rule_a_document_numbers_allowed():
    assert check_numbers("About EUR 200M of annual euro costs from 2027.", [EMAIL]) == []


def test_ORC_6_rule_a_derived_source_never_supports_numbers():
    assert check_numbers("The client spends about $4.1M with us.", [STALE_BRIEFING]) == ["$4.1M"]


def test_ORC_6_rule_b_relationship_metric_needs_sql():
    assert check_numbers("Relationship revenue is $3.4M.", [CHATTY_EMAIL]) == ["$3.4M"]
    assert check_numbers("Relationship revenue is $3.4M.", [CHATTY_EMAIL, SQL_E1]) == []


# The five false positives from the first real run (rule (b) trigger too broad, rule (a) in Uncertainty)
NEWS = {
    "kind": "document",
    "derived": False,
    "text": (
        "agreed to acquire Van Dijk Opslag for EUR 310 million. "
        "Northwind cut its full-year revenue guidance by 3 percent"
    ),
}
NOTE = {"kind": "document", "derived": False, "text": "Credit: the $150M revolver matures in June 2027."}


def test_ORC_6_client_revenue_guidance_is_not_relationship_metric():
    assert check_numbers("Northwind cut its full-year revenue guidance by 3 percent.", [NEWS]) == []
    assert check_numbers("A EUR 310 million acquisition, plus a revenue guidance cut.", [NEWS]) == []


def test_ORC_6_contextual_revolver_mentions_allowed():
    assert check_numbers("He wants EUR 200M hedged and revolver extension options.", [EMAIL]) == []
    assert check_numbers("Options for the $150M revolver maturing June 2027.", [NOTE]) == []


def test_ORC_6_uncertainty_may_quote_stale_value():
    claim = "The prior briefing says revenue was about $4.1M."
    assert check_numbers(claim, [STALE_BRIEFING], allow_derived=True) == []
    assert check_numbers(claim, [STALE_BRIEFING]) == ["$4.1M"]


def test_ORC_6_product_line_revenue_still_needs_sql():
    assert check_numbers(
        "FX revenue fell to $900,000.", [{"kind": "document", "derived": False, "text": "$900,000"}]
    ) == ["$900,000"]
