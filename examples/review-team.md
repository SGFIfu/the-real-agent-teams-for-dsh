# 场景：并行评审团队（review-team）

```text
Create a Review Team over the current diff.

Use:
- security reviewer
- correctness reviewer
- performance reviewer
- test reviewer

Each reviewer inspects the diff independently and reports findings
with severity (critical/high/medium/low) through the team review tools.

The Lead deduplicates findings and sorts them by severity.
Do not modify files unless explicitly asked.
```

要点：只读评审（reviewer 协议默认不改代码）；findings 去重排序由 lead 完成；critical/high 未处理时完成守卫会拦截 `team_complete`。
