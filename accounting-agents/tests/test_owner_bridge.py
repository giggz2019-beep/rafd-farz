"""The owner bridge: she always gets an answer — an ack first, and a failure is said, not swallowed."""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
_spec = importlib.util.spec_from_file_location("owner_bridge", SCRIPTS / "owner_bridge.py")
br = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(br)


class FakeBot:
    def __init__(self):
        self.sent = []

    def send(self, text):
        self.sent.append(text)
        return [len(self.sent)]


def msg(uid, text, **kw):
    return {"update_id": uid, "message_id": uid, "date": "2026-10-13T09:00:00+00:00", "edited": False,
            "text": text, "has_file": bool(kw.get("file")), **kw}


def test_ack_first_then_claude_runs_in_the_checkout_with_a_limited_toolset():
    bot, calls = FakeBot(), []

    def runner(cmd, **kw):
        calls.append((cmd, kw))
        return subprocess.CompletedProcess(cmd, 0, "ok", "")
    assert br.handle(bot, [msg(1, "كم المصروفات؟")], runner=runner)
    assert bot.sent == [br.ACK]
    cmd, kw = calls[0]
    assert cmd[:2] == ["claude", "-p"] and "كم المصروفات؟" in cmd[2] and kw["cwd"] == br.ROOT
    tools = cmd[cmd.index("--allowedTools") + 1: cmd.index("--model")]
    assert "Bash" not in tools and all(t.startswith(("Read", "Grep", "Glob", "Bash(")) for t in tools)


def test_a_failure_or_timeout_is_told_to_her():
    for runner in (lambda cmd, **kw: subprocess.CompletedProcess(cmd, 1, "", "boom"),
                   lambda cmd, **kw: (_ for _ in ()).throw(subprocess.TimeoutExpired(cmd, 1))):
        bot = FakeBot()
        assert not br.handle(bot, [msg(2, "x")], runner=runner)
        assert bot.sent == [br.ACK, br.FAILED]


def test_prompt_carries_history_files_and_marks_what_is_new(tmp_path):
    inbox = tmp_path / "inbox.jsonl"
    inbox.write_text("\n".join(json.dumps(m, ensure_ascii=False) for m in
                               [msg(1, "قديم"), msg(2, "", file="reports/telegram/files/2-photo.jpg")]),
                     encoding="utf-8")
    p = br.build_prompt([msg(2, "", file="reports/telegram/files/2-photo.jpg"), msg(3, "جديد")], inbox=inbox)
    old, new = p.split("الرسائل الجديدة")
    assert "قديم" in old and "2-photo.jpg" not in old
    assert "2-photo.jpg" in new and "جديد" in new


def test_the_team_side_is_in_the_history_so_a_yes_has_its_question(tmp_path):
    inbox = tmp_path / "inbox.jsonl"
    rows = [{"from": "team", "message_id": 9, "date": "d", "text": "أسجّل 2,500 على المعدات؟ نعم / لا"}]
    inbox.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows), encoding="utf-8")
    p = br.build_prompt([msg(10, "نعم")], inbox=inbox)
    old, new = p.split("الرسائل الجديدة")
    assert "الفريق" in old and "2,500" in old and "مريم" in new and "نعم" in new
