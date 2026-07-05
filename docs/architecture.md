# CherryTeam architecture

## Operating ladder

```text
                 Cherry Leadership
            strategy / KPI / approval
                         ↑
                   Cherry Sales
            leads / CRM / proposal / deal
                         ↑
                 Cherry Marketing
          research / campaign / content / brand
                         ↑
                  Cherry Delivery
       workflow / infrastructure / QA / fulfillment
                         ↑
                   Cherry Admin
       access / schedule / records / policy / audit
```

This is an operating-support ladder, not a requirement that every task passes through every layer.

CherryTeam routes routine work directly to its best owner. It adds:

- **Cherry Admin preflight** for access, credentials, production, audit, and high-risk work.
- **Cherry Leadership approval** for high-risk or critical execution proposed by another agent.
- **Direct routing** for normal daily operations, avoiding unnecessary multi-agent cost and latency.

## Runtime

```text
Task / API / CLI / webhook
           ↓
Deterministic team router
           ↓
Risk-aware team plan
           ↓
Agent observe → decide → tool → verify loop
           ↓
Tool gateway: allowlists + workspace sandbox + approvals
           ↓
Evidence-backed result
```

## Production deployment

```text
Channels / CherryFlow / API / webhook
                  ↓
            Durable task queue
                  ↓
          CherryTeam orchestrator
                  ↓
 Admin ─ Delivery ─ Marketing ─ Sales
                  ↑
       Leadership approval queue
                  ↓
      RBAC + audited tool gateway
                  ↓
Proxmox / vLLM / CRM / email / files / web
```

Store credentials in the tool gateway or a secret manager. Never place secrets in prompts, task metadata, or model-visible tool results.

## Agent metrics

| Agent | Operational metrics |
|---|---|
| Cherry Admin | Access lead time, policy failures, audit completeness |
| Cherry Delivery | Completion time, retries, QA pass rate, incident recovery time |
| Cherry Marketing | Qualified demand, conversion, content reuse |
| Cherry Sales | Response time, proposal-to-close rate, pipeline value |
| Cherry Leadership | Approval latency, KPI attainment, risk exceptions |
