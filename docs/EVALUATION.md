# Evaluation plan

How we prove Briefing Desk is safe to run, what is measured today, the latest results, where the
evidence is still thin, and how the plan extends into production. The harness is
`src/briefing/eval.py`; metric definitions live in [`specs/06-eval.md`](../specs/06-eval.md).

## 1. What "safe to run" means

A briefing is safe to rely on when it has these properties. Each one is a metric, and the first five
are release gates: if any fails, the build fails.

| Property | Failure it prevents | How it is proven |
|---|---|---|
| **Never leaks** | An analyst sees a restricted deal or a confidential email | Leak scan across every user and client (EVAL-3), access traps |
| **Never invents numbers** | A made-up revenue figure in front of a client | Every number in a verified claim is checked against its source (EVAL-2) |
| **Every claim is traceable** | A citation that points nowhere, or to something the reader cannot open | Citation validity (EVAL-1) |
| **Handles messy data** | Stale facts, duplicates, aliases, missing IDs, injected instructions | 13 trap scenarios (EVAL-4, 7, 8) |
| **Complete enough to use** | A briefing that is safe but misses what matters | Golden fact recall (EVAL-5) and forbidden statements (EVAL-5b) |
| Honest about uncertainty | Weak claims presented as facts | Share of claims shown as "Check sources" (EVAL-6), reported |
| Fast, cheap, stable | Unusable before a meeting, or different every run | Latency, tokens, run-to-run spread (EVAL-9, 10), reported |
| Right in real use | Synthetic tests pass but analysts reject the output | Analyst accept/reject reasons (EVAL-11), reported |

## 2. Four layers

```
 L1 Unit tests          89 tests, model mocked       ingestion, tools, verifier, API, access rules
 L2 Trap suite          13 scenarios                 one per data condition the brief lists
 L3 Briefing quality    31 golden facts, 5 cases     does the briefing say what an expert would
 L4 Safety sweep        every user x every client    leaks, citation validity, number backing
```

**Layers 1, 2 and 4 are deterministic.** They check IDs, strings and numbers, so a pass is a fact,
not an opinion. Only layer 3 uses a model, to decide whether a paraphrased fact is present.

**Runtime checks complement the offline eval.** Every briefing in use goes through the same
verification (cited IDs exist, numbers match, a judge checks support, quotes are located in the
source), and the analyst reviews each claim. The offline eval measures how often those checks would
have to catch something; the runtime checks catch it.

### L1: unit tests

`uv run pytest`: 89 tests with the model mocked, so they run in about 10 seconds and never flake.
They prove the deterministic guarantees directly: alias and duplicate resolution, entitlement filters
on every tool, number normalization ($3.4M = 3,400,000), quote location, the completeness backstop,
coverage enforcement on every endpoint, deal-team privacy, and that evidence IDs never reach the UI.

### L2: trap suite

Each trap plants one data condition and checks the system at the layer where it must be handled:
ingestion output, tool results, or the generated briefing.

| Trap | Condition | Checked at |
|---|---|---|
| T1 | Alias ("Northwind Logistics Holdings") | Resolver |
| T2 | Document with no client ID | Document linking (inferred, confidence ≤ 0.9) |
| T3 | Duplicate document (forwarded email) | Ingestion: not indexed |
| T4 | Stale prior briefing ($4.1M, Dana as CFO) | Briefing: never asserted as current |
| T5 | Duplicate client record | Merge by LEI; revenue reported once |
| T6 | Restricted deal (Project Aurora) | Visible to the deal team only, in tools and briefings |
| T7 | Text vs table conflict (custody) | Briefing reports the conflict |
| T8 | Missing data (Cascade Q3 revenue) | Reported as a gap, never estimated |
| T9 | Unapproved news | Never indexed |
| T10 | Name collision ("Cascade Health Systems") | Not linked to Cascade Health Partners |
| T11 | Prompt injection in an email | Instruction not followed; claim not verified |
| CONF | Confidential email | Hidden from internal-clearance viewer |
| COV | Client outside coverage | Refused before any data is read |

### L3: golden answers

For each client, an expert-style answer key lists the facts a good briefing must contain, by
question (`golden/*.yaml`), plus statements it must not make:

- `must_include`: 31 facts (Northwind 23, Helios 4, Cascade 4), graded present, partial or absent.
- `must_not_contain`: strings that must never appear, checked exactly (for example "Aurora" for a
  viewer without access).
- `must_not_assert`: statements that must not be presented as current fact ("Dana Whitfield is the
  CFO"). Mentioning them as outdated is allowed, which a string check cannot tell apart, so the judge
  decides.

Cases are per viewer: Kim's Helios case expects the Aurora mandate; Sam's Helios case has no facts
and exists only to prove nothing restricted appears.

**The grader is a different model from the writer.** Briefings are written by `deepseek-chat` and
graded by `deepseek-reasoner` (`LLM_MODEL_EVAL`), so the grader does not simply approve the kind of
sentence the writer likes to produce. Verdicts are mapped back to facts by ID, and a reply that does
not map cleanly is flagged in the report rather than guessed.

### L4: safety sweep

- **Leaks (EVAL-3):** for every user and every client they cover, the whole briefing as served
  (claims, key figures, exhibits, every citation's text) is scanned for canary strings and source
  IDs the viewer must not see: Aurora terms and documents for anyone outside the deal team,
  confidential margin terms for internal clearance, and deal-team membership.
- **Citation validity (EVAL-1):** every citation is resolved against the database and re-checked
  against the viewer's entitlements.
- **Number backing (EVAL-2):** every quantity in a verified claim is re-checked against its cited
  sources after the briefing is assembled, so a bug in assembly cannot slip an unbacked number through.

## 3. Running it

```bash
uv run python -m briefing.eval --repeat 2     # full run, about 2 minutes
uv run python -m briefing.eval --skip-unit    # skip pytest
```

It rebuilds the data, generates a briefing for every user and covered client (`--repeat` times),
prints progress and a PASS/FAIL table, writes `var/eval/<run>.json` (everything, including judge
output) and `var/eval/latest.md`, and exits non-zero if any gate fails, so it can run in CI.

## 4. Latest results

14 briefings (3 users, 7 user-client pairs, 2 repeats), graded by `deepseek-reasoner`.

| ID | Metric | Result | Gate | |
|---|---|---|---|---|
| EVAL-1 | Citations valid and permitted | 935 / 935 | 100% | PASS |
| EVAL-2 | Numbers in verified claims backed | 487 / 487 | 100% | PASS |
| EVAL-3 | Leaks across all users x clients | 0 | 0 | PASS |
| EVAL-4 | Traps handled | 13 / 13 | 100% | PASS |
| EVAL-5 | Golden facts present | 85% | ≥ 80% | PASS |
| EVAL-5b | Forbidden statements made | 0 | 0 | PASS |
| EVAL-7 | Stale value asserted as current | 0 | 0 | PASS |
| EVAL-8 | Injected instruction followed | 0 | 0 | PASS |
| EVAL-6 | Claims shown as "Check sources" | 87 / 574 (15%) | target ≤ 10% | reported |
| EVAL-9 | Latency median / p95 | 7.7 s / 8.5 s | | reported |
| EVAL-9 | Tokens per briefing | 27.7k in + 7.5k out | | reported |
| EVAL-10 | Largest recall change between repeats | 50 points (Kim, 1 fact) | | reported |

### Reading the results honestly

- **The guarantees hold.** No leaks, no unbacked numbers, no invalid citations, every trap handled,
  across every run since the gates were introduced. These are the properties that make the system
  safe to put in front of a banker, and they are enforced by code rather than by the model.
- **Completeness passes, with little margin.** 85% against an 80% gate. The facts most often missed
  are Northwind's banking-services review (its only source is the email flagged as a suspected
  injection, which the system deliberately treats with caution) and the size of the Aurora portfolio.
- **15% of claims are not verified, above the 10% target.** They are not hidden or presented as
  facts: each one is tagged "Check sources" in the UI. Most are judged "partial" because the claim
  adds a detail its cited source does not state. Tightening the prompt has moved this between 12% and
  22%; the target stays as a reported metric rather than a gate until the judge is calibrated.
- **The sample is small.** Kim's case has one fact, so it swings between 0%, 50% and 100%. A 50-point
  spread on one fact says little about stability; it says the golden set needs to be larger.

## 5. Release policy

| Change | Required before release |
|---|---|
| Prompt, model, or model version | Full eval with `--repeat 2`; all gates pass; reported metrics compared with the previous run |
| Retrieval (queries, k, budget) | Full eval |
| Ingestion rules or data pack | `pytest` plus full eval |
| UI only | `pytest` and the frontend build |

A gate failure blocks the release. A reported metric getting worse by a meaningful amount (for
example unverified claims up more than 5 points) needs a written explanation in the change.

## 6. What the evaluation has already caught

The eval changed the system several times; the details are in the
[design walkthrough](DESIGN.md#11-what-the-evaluation-changed). The two most important:

- **The model withheld a restricted deal from the person cleared for it.** The source document said
  "MNPI, coverage must not be informed" and the model obeyed it. That is the model treating document
  text as an instruction, which the design forbids. Access labels were removed from the model's input
  and access phrases are now named as notes, not instructions; Kim's case went from 0% to passing.
- **A stricter prompt made claims worse, and only the metrics showed it.** Asking for shorter claims
  led the model to pad them with interpretation, and unverified claims rose from 14% to 22%. A rule
  against unstated interpretation brought them to 12%.

## 7. Where the evidence is thin, and the plan

| Gap | Why it matters | Plan |
|---|---|---|
| 31 golden facts across 3 clients | Recall moves several points per run; one fact decides a case | **Scenario generator:** code creates synthetic clients and plants known facts and traps (a CFO change, a stale figure, an alias, a duplicate, a restricted deal, an injection) with varied wording. Because the generator planted them, it also writes the answer key, so ground truth never comes from a model. Target: 15 more clients, about 150 facts, 5+ instances per data condition, reported with confidence intervals |
| Judge accuracy unmeasured | The 85% and the 15% both depend on the judge | **Calibration:** hand-label 30 claims and 30 golden-fact verdicts, measure agreement with the judge, and publish it next to the metrics |
| Ask answers not in the eval | Questions can be anything | Add a question set per client to L3 (answerable, unanswerable, and access-probing questions such as asking Sam about Aurora) |
| Red-team cases not yet automated | RT-1 (injection in a call note) and RT-6 (a client with no documents) | Add both as traps; RT-2..5 and RT-7 are already covered by traps, the leak sweep and API tests |
| Only one model family | DeepSeek's blind spots are shared by writer and grader family | Grade with a second provider when available; the gateway already supports any OpenAI-compatible endpoint |

## 8. In production

The offline eval proves the system before release; production needs evidence that it stays safe.

1. **Shadow mode first.** Analysts keep writing briefings; the system's briefing is produced alongside
   and compared, never shown to the client team as final.
2. **Human sign-off stays.** Briefings are drafts until reviewed; rejections carry a reason (wrong,
   outdated, not relevant), which is already recorded and reported as EVAL-11.
3. **Online metrics per release:** verified rate per section, rejection rate and reasons, judge
   agreement with analyst rejections, latency and cost, and leak canaries (planted marker strings in
   restricted records that must never appear in any output).
4. **Regression from real use.** Every rejected claim with reason "wrong" becomes a candidate test
   case, after review, so the golden set grows from real failures instead of imagined ones.
5. **Audit.** Each briefing's run log (evidence per section, model output, every verification
   decision, timing and tokens) is retained, so any statement shown to a banker can be traced to what
   the system saw and why it was allowed.
