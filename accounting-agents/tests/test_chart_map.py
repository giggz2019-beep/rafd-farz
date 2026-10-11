"""The agents' account codes are translated to Daftra's, never sent as they are."""
import json
from pathlib import Path

import pytest

from app.core.ledger import DEFAULT_ACCOUNTS, ChartOfAccounts
from app.daftra.adapter import DaftraConfig, HttpDaftraAdapter, WritesDisabled
from app.daftra.chart_map import DAFTRA_CODES, UnmappedAccount, check_mapping, to_daftra, unmapped

CHART = json.loads((Path(__file__).parent / "fixtures" / "daftra_rafd1_chart.json").read_text())
DAFTRA = CHART["accounts"]


def test_every_internal_account_has_a_mapping_entry():
    assert set(DAFTRA_CODES) == {a.code for a in DEFAULT_ACCOUNTS}


def test_mapping_matches_the_live_rafd1_chart():
    assert check_mapping(ChartOfAccounts(), DAFTRA) == []


def test_the_clashing_codes_are_not_passed_through():
    # internal 5201 is marketing; Daftra 5201 is rent
    assert to_daftra("5201") == "5209" and to_daftra("5501") == "5201"
    assert {a["name"] for a in DAFTRA if a["code"] == "5201"} == {"إيجار"}
    # internal 1201 is receivables; in Daftra 1201 is the treasury category
    with pytest.raises(UnmappedAccount):
        to_daftra("1201")
    with pytest.raises(UnmappedAccount, match="not in the agents' chart"):
        to_daftra("9999")


def test_nothing_is_mapped_by_matching_digits():
    same_digits = [c for c, t in DAFTRA_CODES.items() if t == c]
    assert same_digits == []


def test_unmapped_accounts_are_listed_for_the_owner():
    left = unmapped()
    assert "2201" in left and "5301" in left and "5901" in left
    assert "5501" not in left and "1101" not in left and "5201" not in left


def test_bank_maps_to_the_al_rajhi_account_under_the_bank_category():
    assert to_daftra("1101") == "1202001"
    (acct,) = [a for a in DAFTRA if a["code"] == "1202001"]
    assert acct["type"] == "1"                                   # debit-natured, like any bank account
    assert any(c["code"] == "1202" for c in CHART["categories"])  # sits under 1202 البنك


@pytest.mark.parametrize("mapping_change,expected", [
    ({"5102": "5201"}, "maps to Daftra 5201, already used"),  # two internal accounts on one Daftra account
    ({"5102": "5999"}, "does not exist"),
    ({"2101": "5203"}, "the other side"),                 # a liability onto an expense account
])
def test_a_wrong_mapping_is_caught(mapping_change, expected):
    bad = {**DAFTRA_CODES, **mapping_change}
    problems = check_mapping(ChartOfAccounts(), DAFTRA, bad)
    assert any(expected in p for p in problems), problems


def test_a_missing_or_extra_entry_is_caught():
    bad = {k: v for k, v in DAFTRA_CODES.items() if k != "5901"} | {"7777": None}
    problems = check_mapping(ChartOfAccounts(), DAFTRA, bad)
    assert any(p.startswith("5901") for p in problems) and any(p.startswith("7777") for p in problems)


def _adapter(writes):
    return HttpDaftraAdapter(DaftraConfig(base_url="https://x.daftra.com", journals_path="/j", auth_header="APIKEY",
                                          api_key="k", writes_enabled=writes))


def test_write_path_refuses_an_unmapped_code_and_stays_unimplemented():
    entry = {"lines": [{"account_code": "5901", "debit": "10.00"}, {"account_code": "1101", "credit": "10.00"}]}
    with pytest.raises(WritesDisabled):
        _adapter(False).write_journal(entry)
    with pytest.raises(UnmappedAccount):
        _adapter(True).write_journal(entry)
    with pytest.raises(NotImplementedError):
        _adapter(True).write_journal({"lines": [{"account_code": "5501"}, {"account_code": "3101"}]})
