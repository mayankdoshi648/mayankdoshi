---
type: weekly-review
week: {{date}}
tags: [review, weekly]
---

# Weekly CEO Dashboard — Week of {{date}}

## Daily notes this week

- [[]]
- [[]]
- [[]]
- [[]]
- [[]]
- [[]]
- [[]]

## Open projects

```dataview
TABLE status, priority, updated
FROM "02-Projects"
WHERE type = "project" AND status = "active"
SORT priority ASC
```

## Overdue / due soon tasks

```dataview
TASK
WHERE !completed AND due AND due <= date(today) + dur(7 days)
SORT due ASC
```

## Unfinished ideas / drafts

```dataview
LIST
FROM "06-Content" OR "03-Concepts"
WHERE status = "seed" OR status = "drafting"
SORT file.mtime DESC
LIMIT 15
```

## Wins

-

## Next week priorities

1.
2.
3.
