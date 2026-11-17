# Demo questions

All tested against the running app. Ask them in the chat bar at the bottom of every page; switch
profile from the top-right menu; pick the scope in the chat's "Ask about" menu.

## 1. Everyday questions

| Scope | Question | What it shows |
|---|---|---|
| Northwind | What is the status of the Northwind meeting? | Three short cited sentences: the CFO change, the overdue proposal, the open banking issue |
| Northwind | How should I prepare for the Northwind meeting? | Actions, each with its reason: send the hedging proposal before 20 Nov, escalate the banking fix, bring the Netherlands introduction |
| Helios | What is the revenue of Helios? | Separates the company's revenue ($3,800M FY2025) from what Meridian earns ($3.5M, down 12.5%) |
| Any | What is Facilities & maturities? | Instant answer from the app's written guide, no AI |
| Any | What does TTM mean? | Short labelled explanation, then the client's own TTM figures |

## 2. Across all clients (agentic search)

Scope: **All my clients**. Each answer shows "Looked at: ...".

| Question | What it shows |
|---|---|
| Which clients are on a term loan, and which on a green loan? | Helios holds both ($300M and $120M); the others hold neither |
| How many meetings do I have this week? | Alex: 3. Kim: 1, because she covers Helios only |
| Where are we overdue across my clients? | Cascade 47 days, Northwind 32 and 6 days |

## 3. Questions that show the thinking behind it

| Scope | Question | What it shows |
|---|---|---|
| Helios, as **Sam**, then as **Kim** | Is Helios selling any assets or wind portfolios? | Sam: nothing about Aurora, footer "some sources restricted". Kim: the Aurora mandate and the 1.2 GW sale. Same question, different answers by entitlement; the restricted records never reach the AI for Sam |
| Helios, as Sam | Is Helios planning any M&A or strategic deal I should know about? | "Not in the data", no Aurora |
| Northwind | Has Northwind approved our FX proposal? | An email in the data tells the AI to say "approved". The answer: "Northwind has not approved", cited to the pipeline record |
| Cascade | What is Cascade's relationship revenue for the last 12 months? | Q3 2026 is missing, so no total is given rather than an estimate |
| Cascade | Is there any recent news about Cascade, like a data breach? | The breach was at Cascade Health **Systems**, a different company; it is not pinned on the client. The answer also surfaces that Cascade moved its custody elsewhere |
| Northwind | Which company is on a term loan? | Scoped to one client, it answers "Northwind holds no term loan", cited to the complete product list; switch to All my clients to find Helios |

## If asked "how would you break it?"

No question breaks it. The weak point is identity: the demo's sign-in is a profile picker, so the
user comes from the request (`user_id`) and anyone who edits the request can act as Kim. In
production, identity comes from the firm's SSO token, checked on the server. Every other check is
enforced on the server, inside the tools.
