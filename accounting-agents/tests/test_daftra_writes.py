"""Safe Daftra writes: off by default, every journal tagged, balanced, never posted twice."""
import json
from decimal import Decimal

import httpx
import pytest

from app.daftra.adapter import (DaftraConfig, DaftraError, DaftraUnavailable, HttpDaftraAdapter, WriteRefused,
                                WritesDisabled, tag_prefix)

TAG = "AI-BATCH-2026-10-11"


def adapter(handler, writes=True):
    cfg = DaftraConfig(base_url="https://x.daftra.com/api2", journals_path="/journals.json", auth_header="APIKEY",
                       auth_via_proxy=True, accounts_path="/journal_accounts.json", writes_enabled=writes)
    return HttpDaftraAdapter(cfg, transport=httpx.MockTransport(handler), sleep=lambda s: None)


LINES = [(10, Decimal("100.00"), Decimal("0"), "a"), (11, Decimal("0"), Decimal("100.00"), "b")]


def post(a, **kw):
    args = dict(date="2026-10-11", description=f"[{TAG}] test", number=tag_prefix(TAG) + "0001", tag=TAG, lines=LINES)
    return a.post_journal(**{**args, **kw})


def test_no_key_needed_when_the_proxy_injects_it():
    a = adapter(lambda r: httpx.Response(202, json={"id": 7}))
    assert "APIKEY" not in a.http.headers


def test_writes_are_off_by_default():
    sent = []
    a = adapter(lambda r: sent.append(r) or httpx.Response(202, json={"id": 1}), writes=False)
    with pytest.raises(WritesDisabled):
        post(a)
    with pytest.raises(WritesDisabled):
        a.create_account(journal_cat_id=1, code="99", name="x", debit_nature=True)
    assert not sent


@pytest.mark.parametrize("kw,match", [
    ({"description": "no tag"}, "must start with"),
    ({"number": "123"}, "number must start"),
    ({"lines": [(10, Decimal("100"), Decimal("0"), "a"), (11, Decimal("0"), Decimal("99"), "b")]}, "unbalanced"),
    ({"lines": [(10, Decimal("-5"), Decimal("0"), "a"), (11, Decimal("0"), Decimal("-5"), "b")]}, "unbalanced"),
    ({"lines": [(10, Decimal("5"), Decimal("5"), "a")]}, "two lines"),
])
def test_unsafe_journals_are_refused_before_anything_is_sent(kw, match):
    sent = []
    a = adapter(lambda r: sent.append(r) or httpx.Response(202, json={"id": 1}))
    with pytest.raises(WriteRefused, match=match):
        post(a, **kw)
    assert not sent


def test_journal_body_matches_the_documented_shape():
    seen = {}

    def h(r):
        seen.update(json.loads(r.content)); return httpx.Response(202, json={"result": "successful", "id": 42})
    assert post(adapter(h)) == 42
    assert seen["Journal"]["number"] == "AI20261011-0001" and seen["Journal"]["currency_code"] == "SAR"
    assert [t["journal_account_id"] for t in seen["JournalTransaction"]] == [10, 11]
    assert sum(t["currency_debit"] for t in seen["JournalTransaction"]) == 100.0


def test_a_post_is_sent_once_even_when_it_fails():
    calls = []
    a = adapter(lambda r: calls.append(r) or httpx.Response(503, json={}))
    with pytest.raises(DaftraError):
        post(a)
    assert len(calls) == 1                      # a retried POST could book the entry twice

    def boom(r):
        calls.append(r); raise httpx.ConnectError("down")
    with pytest.raises(DaftraUnavailable, match="re-read"):
        post(adapter(boom))


def test_rollback_deletes_only_tagged_journals():
    deleted = []

    def h(r):
        if r.method == "GET":
            return httpx.Response(200, json={"data": {"Journal": {"description": "manual entry by a person"}}})
        deleted.append(r); return httpx.Response(200, json={})
    with pytest.raises(WriteRefused, match="does not carry"):
        adapter(h).delete_journal("5", tag=TAG)
    assert not deleted
