"""Exercise the actual occupancy blueprint templates with Jinja2.

Run: uv run --no-project --with jinja2 python scripts/test-occupancy-templates.py
"""
import json
import re
from pathlib import Path
from types import SimpleNamespace as NS
from jinja2 import Environment, StrictUndefined

source = (Path(__file__).resolve().parent.parent / "shared/blueprints/occupancy.ts").read_text(encoding="utf-8")
guards = re.findall(r'^\s+value_template: (".*")$', source, re.M)
guards = [json.loads(x) for x in guards if "trigger.from_state" in x]
assert len(guards) == 2 and guards[0] == guards[1]
env = Environment(undefined=StrictUndefined)
guard = env.from_string(guards[0])
def state(name, **attributes):
    return NS(state=name, attributes=attributes)
def valid(old, new):
    return guard.render(trigger=NS(from_state=old, to_state=new)).strip().lower() == "true"
a = state("playing", volume_level=0.3, is_volume_muted=False, source="HDMI", media_position=1)
for b in [state("playing", volume_level=0.4), state("playing", is_volume_muted=True), state("playing", source="TV")]:
    assert valid(a, b)
for b in [state("playing", volume_level=0.3, is_volume_muted=False, source="HDMI", media_position=2), state("on"), state("off", volume_level=0.4), state("unavailable", volume_level=0.4), None]:
    assert not valid(a, b)
for old in [None, state("unknown", volume_level=0.3), state("off", volume_level=0.3), state("playing")]:
    assert not valid(old, state("playing", volume_level=0.4))
assert not valid(state("playing", volume_level=False), state("playing", volume_level=True))
assert not valid(state("playing", source=""), state("playing", source="TV"))
assert not valid(state("playing", is_volume_muted="false"), state("playing", is_volume_muted=True))
match = re.search(r'^\s+duration: (".*")$', source, re.M)
assert match
duration = env.from_string(json.loads(match.group(1)))
for trigger_id, expected in [("tv_start", "00:07:00"), ("tv_hold", "00:07:00"), ("start_on", "01:00:00")]:
    assert duration.render(trigger=NS(id=trigger_id), hold_minutes=7, minutes=60) == expected
print("Actual occupancy Jinja templates: interaction and duration cases passed")
