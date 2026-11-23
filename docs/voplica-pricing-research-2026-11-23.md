# Voplica MiniMax pricing research — 23 November 2026

This is a public-source commercial/technical research note. No paid generation, purchase, upload, account change or support message was performed. The current API does not provide a binding, settings-specific MiniMax quotation before execution.

## Verified model coverage

| Vela model | Public Voplica variant | Family |
| --- | --- | --- |
| MiniMax H3 | `01M6MQG2J9ZF86MES4FJ4MR1DJ` | MINIMAX_H3 |
| H3 Eros Max · Beta7 | `01M765CW9DP2X9GD4MG8G54P2V` | MINIMAX_H3 |

Read-only `GetModelVariant` calls returned both variants as published/inference-enabled. Beta7 is the user's selected reference checkpoint. Current Vela requests use 1280×736, 736×1280 or 960×960 pixels and 124/243/362 frames at 24 fps for the UI's approximately 5/10/15-second options. These dimensions are not interchangeable with another provider's exact 1280×720 tariff.

Sources: [official API definitions](https://github.com/voplica/api), [Beta7](https://voplica.com/models/01M765C1GX68BXWVH35PQA1PBF/variant/01M765CW9DP2X9GD4MG8G54P2V).

## Cash cost of provider credits

The public pricing catalogue was checked through the website's read-only `voplica.api.price.PriceService/ListProducts` RPC on 23 November. The service and request shape were identified in Voplica's publicly delivered website client. Active products:

| Product | Price | Provider credits | Cash cost per credit |
| --- | ---: | ---: | ---: |
| Anytime pack | $7 | 500 | $0.014000 |
| Anytime pack | $20 | 1,500 | $0.013333 |
| Anytime pack | $65 | 5,000 | $0.013000 |
| Base monthly | $19/month | 1,500 allowance | $0.012667 if fully consumed |
| Premium monthly | $59/month | 5,000 allowance | $0.011800 if fully consumed |

Annual product prices are $180 Base and $564 Premium. The catalogue response alone does not establish the annual grant/reset schedule, so this report deliberately does not assume 12 grants or quote an annual effective cost.

The Anytime products describe their credits as non-expiring. Subscription allowances expire/reset; under-utilization raises the effective cost per consumed credit. Use **$0.014/provider credit** as the conservative acquisition assumption until actual purchasing terms change. Do not anchor prices to a temporarily cheaper plan that Vela does not fully consume.

Sources: [Voplica pricing](https://voplica.com/pricing), [read-only catalogue endpoint](https://api.voplica.com/voplica.api.price.PriceService/ListProducts), [payment/credit schema](https://github.com/voplica/api/blob/main/proto/voplica/types/payment/payment.proto).

**Unit distinction:** wire amounts use milli-credits, 1,000 milli-credits = 1 provider credit. The schema's nominal cent-valued credit is not the same as the cash paid to buy a credit pack. At the conservative acquisition rate:

`provider cash cost USD = creditsNetChargedMilli ÷ 1000 × 0.014`

Never equate Voplica credits, Vela tokens and BytePlus video tokens.

## Why there is no truthful fixed MiniMax cost table yet

The live video workflow `workflow.video.gen.enriched.v1` / `01M6MQJ5G8ESWMGB3TH7F28PXH` returns:

- `creditsPricingHintMilli = 37000` — 37 credits, an average **hint**.
- `initialCreditsReservationMilli = 10000` — 10 credits required initially.

The official schema explicitly says the hint is not the final price; the final charge is calculated after execution. The reservation is not a maximum. Neither number is a quotation for 5 seconds, 720p, a specific checkpoint or a reference count. The workflow also includes optional steps which Vela does not request.

[Workflow pricing contract](https://github.com/voplica/api/blob/main/proto/voplica/types/workflow/workflow_definition.proto), [workflow concepts](https://docs.voplica.com/api/concepts/workflows/).

Voplica documents metering for GPU/CPU time and data read/write on hosted models; third-party models use upstream charges. A Trusted/private-hardware mode adds 10% and can inherit the account default. API payments draw on plan, Anytime and Earned credits, not free credits. Unused reservations return, but some request-caused failures remain billable. Final reconciliation must use net charged credits, including reversals. A dry-run only validates admission; it does not calculate an output cost.

[Billing and limits](https://docs.voplica.com/billing/), [dry-run request/response schema](https://github.com/voplica/api/blob/main/proto/voplica/api/workflow/workflow_execution.proto).

No official fixed fee per H3 reference image was found. More references, larger reference files and identity conditioning can change computation/data usage; inventing a universal “+$X per reference” would not establish the requested margin. A character sheet is one uploaded reference, not necessarily one billable item per original face/body photo.

## Scenario economics, not output quotes

At $0.014/provider credit and $0.001/Vela token, round the retail charge upward to whole Vela tokens:

| Actual provider credits | Cash COGS | 70% markup tokens | 75% markup tokens | 80% markup tokens |
| ---: | ---: | ---: | ---: | ---: |
| 10 | $0.140 | 238 | 245 | 252 |
| 25 | $0.350 | 595 | 613 | 630 |
| 37 | $0.518 | 881 | 907 | 933 |
| 50 | $0.700 | 1,190 | 1,225 | 1,260 |
| 75 | $1.050 | 1,785 | 1,838 | 1,890 |
| 100 | $1.400 | 2,380 | 2,450 | 2,520 |
| 150 | $2.100 | 3,570 | 3,675 | 3,780 |

These are arithmetic sensitivities to **actual** charged credits. They are not duration tiers, and the 37-credit row is not a verified MiniMax output price. Infrastructure, merchant fees, refunds, taxes and welcome-token acquisition cost are additional expenses.

A 75% markup means price = 1.75 × COGS, giving 42.86% gross margin before those expenses. It does not mean 75% gross margin.

## Launch pricing policy

Keep Voplica retail execution unavailable until either a provider-agreed upper bound or a funded benchmark supports a settings-specific reservation. A development/demo tariff may be shown only as an explicit provisional estimate, never a verified live margin. Capture must not silently exceed the price accepted by the customer; Vela bears an unexpected overrun or requires a separately authorized revised quote before a future run.

A small proposed benchmark: each of the two checkpoints × 5/10/15 seconds × 0/1/3/9 references, using non-sensitive synthetic scenes. Include all supported aspect ratios in follow-up samples and repeat expensive/high-variance combinations. Record dimensions, native frame count, reference bytes/count, privacy mode, creator fees if present, final net charge, rejected/billable failure and output quality. This requires a separately scoped funded test; no benchmark was run here.

## Commercial authorization

Voplica's Terms prohibit resale without authorization. A functioning API key does not establish permission to resell generation inside Vela. Confirm Vela's intended commercial use before enabling customer-funded production inference. This does not prevent completing the local fake-payment/token implementation.

[Terms of Use, sections 3 and 6](https://voplica.com/terms-of-use).
