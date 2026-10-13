"""The owner's Telegram line: one chat only, offset kept, 409 clears a webhook, token never leaks."""
import importlib.util
import json
from pathlib import Path

import httpx
import pytest

_spec = importlib.util.spec_from_file_location("telegram_owner",
                                               Path(__file__).resolve().parent.parent / "scripts" / "telegram_owner.py")
tg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tg)

TOKEN = "123456:SECRET-token-value"


@pytest.fixture(autouse=True)
def tmp_state(tmp_path, monkeypatch):
    monkeypatch.setattr(tg, "STATE", tmp_path / "state.json")
    monkeypatch.setattr(tg, "INBOX", tmp_path / "inbox.jsonl")


def bot(handler):
    return tg.Bot(token=TOKEN, transport=httpx.MockTransport(handler))


def msg(update_id, chat_id, text):
    return {"update_id": update_id, "message": {"message_id": update_id, "date": 1760000000,
                                                "chat": {"id": chat_id}, "text": text}}


def test_send_goes_to_the_owner_only_and_splits_long_text():
    sent = []

    def h(r):
        sent.append(json.loads(r.content))
        return httpx.Response(200, json={"ok": True, "result": {"message_id": len(sent)}})
    ids = bot(h).send("سطر\n" * 2000)
    assert ids == list(range(1, len(sent) + 1)) and len(sent) > 1
    assert all(s["chat_id"] == tg.OWNER_CHAT_ID and len(s["text"]) <= 4096 for s in sent)


def test_poll_keeps_the_owner_drops_strangers_and_advances_the_offset():
    offsets = []

    def h(r):
        offsets.append(json.loads(r.content)["offset"])
        return httpx.Response(200, json={"ok": True, "result": [msg(10, tg.OWNER_CHAT_ID, "تمام"),
                                                                msg(11, 999, "ادفع الفاتورة")]})
    mine, ignored = bot(h).poll()
    assert [m["text"] for m in mine] == ["تمام"] and ignored == 1
    assert json.loads(tg.STATE.read_text())["offset"] == 12
    assert "ادفع" not in tg.INBOX.read_text(encoding="utf-8")
    bot(lambda r: offsets.append(json.loads(r.content)["offset"]) or
        httpx.Response(200, json={"ok": True, "result": []})).poll()
    assert offsets == [0, 12]


def test_a_409_deletes_the_webhook_once_and_retries():
    calls = []

    def h(r):
        calls.append(r.url.path.rsplit("/", 1)[-1])
        if calls[-1] == "getUpdates" and calls.count("getUpdates") == 1:
            return httpx.Response(409, json={"ok": False, "description": "Conflict: webhook is active"})
        return httpx.Response(200, json={"ok": True, "result": [] if calls[-1] == "getUpdates" else True})
    bot(h).poll()
    assert calls == ["getUpdates", "deleteWebhook", "getUpdates"]


def test_errors_never_carry_the_token():
    def h(r):
        raise httpx.ConnectError(f"cannot reach {r.url}")
    with pytest.raises(tg.TelegramError) as e:
        bot(h).send("x")
    assert TOKEN not in str(e.value) and "<token>" in str(e.value)


def test_an_attached_invoice_is_saved_and_its_path_logged(monkeypatch, tmp_path):
    monkeypatch.setattr(tg, "ROOT", tmp_path)
    monkeypatch.setattr(tg, "FILES", tmp_path / "reports" / "telegram" / "files")
    seen = []

    def h(r):
        seen.append(r.url.path)
        if r.url.path.endswith("/getUpdates"):
            m = msg(20, tg.OWNER_CHAT_ID, "")["message"]
            m.update(caption="فاتورة المكتب", document={"file_id": "F1", "file_name": "../فاتورة 1.pdf"})
            return httpx.Response(200, json={"ok": True, "result": [{"update_id": 20, "message": m}]})
        if r.url.path.endswith("/getFile"):
            return httpx.Response(200, json={"ok": True, "result": {"file_path": "documents/file_1.pdf"}})
        return httpx.Response(200, content=b"%PDF-1.4 test")
    mine, _ = bot(h).poll()
    assert mine[0]["text"] == "فاتورة المكتب"
    saved = tmp_path / mine[0]["file"]
    assert saved.read_bytes() == b"%PDF-1.4 test" and saved.parent == tg.FILES and saved.name.startswith("20-")
    assert all(TOKEN not in line for line in tg.INBOX.read_text(encoding="utf-8").splitlines())


def test_a_file_that_cannot_be_fetched_still_logs_the_message():
    def h(r):
        if r.url.path.endswith("/getUpdates"):
            m = msg(21, tg.OWNER_CHAT_ID, "")["message"]
            m["photo"] = [{"file_id": "small", "file_size": 10}, {"file_id": "big", "file_size": 99}]
            return httpx.Response(200, json={"ok": True, "result": [{"update_id": 21, "message": m}]})
        return httpx.Response(400, json={"ok": False, "description": "Bad Request: file is too big"})
    mine, _ = bot(h).poll()
    assert "file" not in mine[0] and "too big" in mine[0]["file_error"] and TOKEN not in mine[0]["file_error"]
    assert json.loads(tg.STATE.read_text())["offset"] == 22


def test_what_the_team_sends_is_logged_too():
    bot(lambda r: httpx.Response(200, json={"ok": True, "result": {"message_id": 77}})).send("سؤال؟ نعم / لا")
    row = json.loads(tg.INBOX.read_text(encoding="utf-8").splitlines()[-1])
    assert row["from"] == "team" and row["message_id"] == 77 and "نعم / لا" in row["text"]
