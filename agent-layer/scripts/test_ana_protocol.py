#!/usr/bin/env python3
"""Contract test for the ana-project todo / done / daily-note protocol."""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills" / "ana-project" / "SKILL.md"
README = ROOT / "README.md"
APPLY = ROOT / "scripts" / "apply-ana-project"

SKILL_NEEDLES = [
    "These files are separate from the session-start read.",
    ".ana/todo.md",
    ".ana/done.md",
    ".ana/notes/YYYY-MM-DD.md",
    "date +%Y-%m-%d",
    "Groups are `##` headings.",
    "the line under `# Todo` is the count of each group",
    "Put the newest line directly under the heading",
    "A GitHub issue that was never a todo does not get a line.",
    "Suggest a GitHub issue",
    "File it only after a yes",
    ".ana/issues/NNNN-short-kebab.md",
    "closed-",
    "deferred-",
    "- Picked: item",
    "- Done: item",
    "- Deferred: item",
    "Personal notes stay in `.ana/`.",
    "Do not invent keys.",
]

README_NEEDLES = [
    ".ana/todo.md",
    ".ana/done.md",
    ".ana/notes/YYYY-MM-DD.md",
    ".ana/issues/",
    "created on first use",
]

STUB_NEEDLES = [
    ".ana/todo.md",
    ".ana/done.md",
    ".ana/notes/",
    ".ana/issues/",
    "Created on first use.",
]

FORBIDDEN = [
    "A to-do list and other ana-project behavior will be properties here.",
    "A to-do list and further behavior are future properties, not separate protocols.",
]


def fail(msg: str) -> None:
    print(f"FAIL: {msg}")
    sys.exit(1)


def section(text: str, heading: str) -> str:
    start = text.index(heading)
    rest = text[start + len(heading):]
    nxt = rest.find("\n## ")
    return rest if nxt < 0 else rest[:nxt]


def main() -> None:
    skill = SKILL.read_text()
    readme = README.read_text()
    apply = APPLY.read_text()

    for needle in SKILL_NEEDLES:
        if needle not in skill:
            fail(f"skill missing: {needle}")
    for needle in README_NEEDLES:
        if needle not in readme:
            fail(f"readme missing: {needle}")
    for needle in STUB_NEEDLES:
        if needle not in apply:
            fail(f"apply stub missing: {needle}")
    for needle in FORBIDDEN:
        if needle in skill or needle in readme:
            fail(f"old future-property sentence still present: {needle}")

    start = section(skill, "## On every session")
    for needle in ("settings.json", "learnings.md", "mistakes.json", "MEMORY.md"):
        if needle not in start:
            fail(f"session-start section lost {needle}")
    if "todo.md" in start or "done.md" in start or "notes/" in start:
        fail("session-start section lists a todo, done, or notes file")

    for plugin in ("claude", "codex", "cursor"):
        link = ROOT / "plugins" / plugin / "skills" / "ana-project" / "SKILL.md"
        if link.resolve() != SKILL.resolve():
            fail(f"{plugin} skill path does not resolve to the one skill file")

    with tempfile.TemporaryDirectory(prefix="ana-protocol-") as tmp:
        proc = subprocess.run(
            [sys.executable, str(APPLY), "--layout", "wrapper", "--root", tmp, "--dry-run"],
            capture_output=True, text=True, timeout=20,
        )
        if proc.returncode != 0:
            fail(f"dry-run exited {proc.returncode}: {proc.stderr}")
        out = proc.stdout
        for banned in (".ana/todo.md", ".ana/done.md", ".ana/notes", ".ana/issues"):
            if banned in out:
                fail(f"dry-run would create {banned}:\n{out}")

    print("ok")


if __name__ == "__main__":
    main()
