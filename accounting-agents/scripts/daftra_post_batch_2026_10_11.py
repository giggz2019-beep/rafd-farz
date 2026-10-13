"""AI-BATCH-2026-10-11 — the owner-approved posting run into rafd1.daftra.com.

Creates the missing accounts (re-uses any code that already exists), posts every journal of the
plan with the batch tag and an AI20261011-NNNN number, skips numbers already posted (safe to re-run),
verifies the first entries by reading them back, then checks the Al Rajhi bank account against the
statement's closing balance. Stops at the first refused write. Writes nothing but to Daftra and to
OUT (results.json) and the repo test fixture.
"""
import json, re, sys, time, unicodedata
from decimal import Decimal as D
from pathlib import Path

import httpx
import openpyxl

TAG = "AI-BATCH-2026-10-11"
PREFIX = "AI20261011-"
BASE = "https://rafd1.daftra.com/api2"
DRAFT = "/root/.claude/uploads/dcc503ee-1909-5891-adb0-57ad74985d6e/8cd753d5-journal_draft.xlsx"
OUT = Path(__file__).parent
FIXTURE = Path("/home/user/rafd-farz/accounting-agents/tests/fixtures/daftra_rafd1_chart.json")
STATEMENT_CLOSING = D("71245.47")

SUS, OWN, STC, BANK = "حساب معلّق (تحت التصنيف)", "جاري المالكة", "بنك STC (مؤقت)", "البنك - الراجحي (الشركة)"
# draft name -> (code, Daftra name, parent category CODE, debit nature); None = already exists
ACCOUNTS = {
    OWN: ("33", "جاري المالكة", "3", False),
    SUS: ("1211", "حساب معلّق (تحت التصنيف)", "12", True),
    "بطاقة الشركة 1146 (مسبقة الدفع)": ("120102", "بطاقة الشركة 1146 (مسبقة الدفع)", "1201", True),
    STC: ("1202002", "بنك STC (مؤقت)", "1202", True),
    "مصروف اشتراكات برمجية": ("5207", "مصروف اشتراكات برمجية", "52", True),
    "مصروف التأمينات الاجتماعية": ("5208", "مصروف التأمينات الاجتماعية", "52", True),
    "مصروف تسويق وإعلان": ("5209", "مصروف تسويق وإعلان", "52", True),
    "مصروف شحن وبريد": ("5210", "مصروف شحن وبريد", "52", True),
    "مصروف رسوم بنكية": ("5211", "مصروف رسوم بنكية", "52", True),
    "إيرادات": ("413", "إيرادات الخدمات", "41", False),
    BANK: ("1202001", None, None, True),
    "مصروف رسوم حكومية": ("5206", None, None, True),       # «مصاريف حكومية» already in Daftra
}

c = httpx.Client(base_url=BASE, timeout=40, headers={"Accept": "application/json"})


def get_all(path):
    rows, page = [], 1
    while True:
        r = c.get(path, params={"page": page, "limit": 100})
        if r.status_code == 429: time.sleep(10); continue
        r.raise_for_status(); b = r.json()
        rows += b.get("data") or []
        pg = b.get("pagination") or {}
        if not pg.get("next"): return rows
        page += 1


def send(method, path, body=None):
    # 429 = rate limited, the request was NOT processed — the one case where resending is safe
    for wait in (3, 6, 12, 24, 48, 60, 60):
        r = c.request(method, path, json=body, headers={"Content-Type": "application/json"})
        if r.status_code != 429:
            break
        time.sleep(wait)
    try: data = r.json()
    except ValueError: data = {"raw": r.text[:300]}
    if r.status_code >= 400:
        raise SystemExit(f"STOP — {method} {path} refused: HTTP {r.status_code} {json.dumps(data, ensure_ascii=False)[:600]}")
    return data


def mask(s):
    return re.sub(r"\d{10,}", lambda m: "••••" + m.group()[-4:], s)


def build_plan():
    rows = [r for r in openpyxl.load_workbook(DRAFT, data_only=True)["القيود المقترحة"].iter_rows(min_row=2, values_only=True) if r[0]]
    plan = []
    for r in rows:
        date, desc, dr, cr, amt, status, src = r[:7]
        dr = OWN if str(dr).startswith(OWN) else dr
        cr = OWN if str(cr).startswith(OWN) else cr
        n = unicodedata.normalize("NFKC", str(desc))
        if status == "جاهز — راجعي":
            cr = SUS
        elif "صادر غير مصنّف" in n and "شركة رفد الرقمية" in n:        # owner: transfers to the STC company account
            dr = STC
        elif "وارد غير مصنّف" in n and "8964FR" in n:                  # owner: personal money, not the company's
            cr = OWN
        plan.append({"date": str(date).replace("/", "-"), "desc": mask(n), "dr": dr, "cr": cr,
                     "amt": D(str(amt)).quantize(D("0.01")), "src": src})
    plan.sort(key=lambda p: p["date"])                                  # stable: keeps draft order within a day
    for i, p in enumerate(plan, 1):
        p["number"] = f"{PREFIX}{i:04d}"
    return plan


def main():
    cats = {x["JournalCat"]["code"]: x["JournalCat"]["id"] for x in get_all("/journal_cats.json")}
    accts = {x["JournalAccount"]["code"]: x["JournalAccount"]["id"] for x in get_all("/journal_accounts.json")}
    created, ids = [], {}
    for name, (code, dname, cat_code, debit) in ACCOUNTS.items():
        if code not in accts:
            if dname is None:
                raise SystemExit(f"STOP — expected existing account {code} is missing")
            d = send("POST", "/journal_accounts.json", {"JournalAccount": {
                "journal_cat_id": int(cats[cat_code]), "code": code, "name": dname, "type": 1 if debit else 0}})
            accts[code] = str(d["id"]); created.append(code)
            print(f"account created {code} {dname} id={d['id']}")
        ids[name] = int(accts[code])

    plan = build_plan()
    existing = {str((x.get("Journal") or {}).get("number")) for x in get_all("/journals.json")}
    results, posted, skipped = [], 0, 0
    first_bank_checked = first_checked = False
    for p in plan:
        if p["number"] in existing:
            skipped += 1; continue
        suspense = SUS in (p["dr"], p["cr"])
        desc = f"[{TAG}] {p['desc']}" + (" — سؤال مفتوح: في الحساب المعلّق حتى تجيب المالكة" if suspense else "")
        body = {"Journal": {"date": p["date"], "description": desc[:500], "number": p["number"],
                            "currency_code": "SAR", "draft": 0},
                "JournalTransaction": [
                    {"journal_account_id": ids[p["dr"]], "currency_debit": float(p["amt"]), "currency_credit": 0, "description": p["desc"][:200]},
                    {"journal_account_id": ids[p["cr"]], "currency_debit": 0, "currency_credit": float(p["amt"]), "description": p["desc"][:200]}]}
        d = send("POST", "/journals.json", body)
        jid = d["id"]; posted += 1
        results.append({"number": p["number"], "id": jid, "date": p["date"], "dr": p["dr"], "cr": p["cr"],
                        "amount": str(p["amt"]), "suspense": suspense})
        touches_bank = BANK in (p["dr"], p["cr"])
        if not first_checked or (touches_bank and not first_bank_checked):
            back = c.get(f"/journals/{jid}.json").json()
            txt = json.dumps(back, ensure_ascii=False)
            if TAG not in txt or str(p["amt"]).rstrip("0").rstrip(".") not in txt:
                raise SystemExit(f"STOP — journal {jid} read back without the tag/amount: {txt[:600]}")
            if p["number"] not in txt:
                raise SystemExit(f"STOP — Daftra did not keep the number {p['number']}; a re-run could duplicate. "
                                 f"Posted so far: {posted} (journal {jid}). {txt[:400]}")
            print(f"verified by read-back: {p['number']} id={jid} {p['dr']} / {p['cr']} {p['amt']}")
            first_checked = True; first_bank_checked = first_bank_checked or touches_bank
        time.sleep(0.8)
    (OUT / "results.json").write_text(json.dumps({"created_accounts": created, "journals": results},
                                                 ensure_ascii=False, indent=1))

    # reconciliation: what was posted to the bank, and what Daftra now reports for it
    bank_net = sum((D(r["amount"]) if r["dr"] == BANK else -D(r["amount"])) for r in results if BANK in (r["dr"], r["cr"]))
    acct = c.get(f"/journal_accounts/{accts['1202001']}.json").json()
    ja = (acct.get("data") or acct).get("JournalAccount", {})
    print(f"\nposted {posted}, already there {skipped}, plan {len(plan)}")
    print(f"suspense entries {sum(r['suspense'] for r in results)}")
    print(f"bank 1202001 — posted net {bank_net} | Daftra totals debit {ja.get('total_debit')} credit {ja.get('total_credit')} | statement closing {STATEMENT_CLOSING}")

    fresh = get_all("/journal_accounts.json")
    FIXTURE.write_text(json.dumps({
        "source": "rafd1.daftra.com GET /api2/journal_accounts.json and /api2/journal_cats.json, 2026-10-11, after the AI-BATCH-2026-10-11 accounts were created (codes, names, nature only)",
        "accounts": [{"code": x["JournalAccount"]["code"], "name": x["JournalAccount"]["name"], "type": x["JournalAccount"]["type"]} for x in fresh],
        "categories": [{"code": x["JournalCat"]["code"], "name": x["JournalCat"]["name"]} for x in get_all("/journal_cats.json")],
    }, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
