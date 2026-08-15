# 场景：调试团队（debugging-team）

```text
Create a Debugging Agent Team.

Spawn four teammates, each with a different root-cause hypothesis for the bug
I point you at.

They investigate independently, exchange evidence through team messages,
and challenge conflicting conclusions.

The Lead ranks hypotheses by evidence.
Only then implement the most likely fix.
Use a tester teammate and a reviewer teammate to validate the result.
```

要点：多假设并行排查 + 证据交换 + 冲突质证；实现放在证据排序之后；tester 验证 + reviewer 复核后才允许 `team_complete`。
