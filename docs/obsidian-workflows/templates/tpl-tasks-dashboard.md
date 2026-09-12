---
type: dashboard
tags: [tasks, dashboard]
---

# Task Query Dashboard

Pin this note or open it each morning. Requires Dataview (or adapt for the Tasks plugin).

## Today

```dataview
TASK
WHERE !completed AND due = date(today)
SORT priority ASC
```

## Overdue

```dataview
TASK
WHERE !completed AND due AND due < date(today)
SORT due ASC
```

## Next 7 days

```dataview
TASK
WHERE !completed AND due AND due > date(today) AND due <= date(today) + dur(7 days)
SORT due ASC
```

## By project (active)

```dataview
TASK
FROM "02-Projects"
WHERE !completed
GROUP BY file.link
```

## No due date (triage)

```dataview
TASK
WHERE !completed AND !due
LIMIT 30
```
