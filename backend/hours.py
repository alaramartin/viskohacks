"""Minimal OSM `opening_hours` evaluator.

Handles the common shapes (`24/7`, `Mo-Fr 09:00-17:00; Sa 10:00-14:00`,
`18:00-02:00`, `Su off`). Anything else returns None ("hours unknown") rather
than guessing.
"""

import re
from datetime import datetime

DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
_DAY_RANGE = r"[A-Z][A-Za-z](?:\s*-\s*[A-Z][A-Za-z])?"  # also PH/SH, which _days() skips
_TIME_RANGE = r"\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\+?"
_RULE = re.compile(
    rf"^(?:(?P<days>{_DAY_RANGE}(?:\s*,\s*{_DAY_RANGE})*)\s+)?"
    rf"(?P<times>off|closed|24/7|{_TIME_RANGE}(?:\s*,\s*{_TIME_RANGE})*)$"
)


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _days(expr: str) -> list[int] | None:
    out = []
    for part in expr.split(","):
        ends = [p.strip() for p in part.split("-")]
        if any(e not in DAYS for e in ends):
            return None  # PH, SH, month names, ...
        a, b = DAYS.index(ends[0]), DAYS.index(ends[-1])
        out.extend(range(a, b + 1) if a <= b else [*range(a, 7), *range(0, b + 1)])
    return out


def is_open(spec: str | None, when: datetime) -> bool | None:
    if not spec:
        return None
    spec = spec.strip()
    if spec == "24/7":
        return True

    schedule: dict[int, list[tuple[int, int]]] = {}
    parsed_any = False
    for rule in filter(None, (r.strip() for r in spec.split(";"))):
        match = _RULE.match(rule)
        if not match:
            return None
        days = _days(match["days"]) if match["days"] else list(range(7))
        if days is None:
            continue  # holiday rules etc. don't affect an ordinary day
        parsed_any = True
        times = match["times"]
        if times in ("off", "closed"):
            intervals = []
        elif times == "24/7":
            intervals = [(0, 1440)]
        else:
            intervals = []
            for span in times.split(","):
                start, end = (s.strip().rstrip("+") for s in span.split("-"))
                intervals.append((_minutes(start), _minutes(end)))
        for day in days:
            schedule[day] = intervals
    if not parsed_any:
        return None

    today, minute = when.weekday(), when.hour * 60 + when.minute
    for start, end in schedule.get(today, []):
        if (start < end and start <= minute < end) or (end <= start and minute >= start):
            return True
    for start, end in schedule.get((today - 1) % 7, []):
        if end <= start and minute < end:  # yesterday's interval running past midnight
            return True
    return False
