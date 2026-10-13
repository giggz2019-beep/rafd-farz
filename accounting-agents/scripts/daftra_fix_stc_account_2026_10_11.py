"""Move the 12 tagged journals that hit 1202002 (the owner's PERSONAL Al Rajhi treasury) to a new
STC account 1202003. Backup first; each journal is deleted (tag-checked) and re-posted with the same
number, date and amounts, only the account swapped."""
import httpx, json, time, sys
from decimal import Decimal as D
c = httpx.Client(base_url="https://rafd1.daftra.com/api2", timeout=40, headers={"Accept": "application/json"})
def req(m, path, **kw):
    for w in (3, 6, 12, 24, 48, 60):
        r = c.request(m, path, **kw)
        if r.status_code != 429: break
        time.sleep(w)
    if r.status_code >= 400: raise SystemExit(f"STOP {m} {path}: {r.status_code} {r.text[:400]}")
    return r.json()
def get_all(path):
    rows, page = [], 1
    while True:
        b = req("GET", path, params={"page": page, "limit": 100}); rows += b.get("data") or []
        if not (b.get("pagination") or {}).get("next"): return rows
        page += 1
acc = {x["JournalAccount"]["code"]: int(x["JournalAccount"]["id"]) for x in get_all("/journal_accounts.json")}
cats = {x["JournalCat"]["code"]: int(x["JournalCat"]["id"]) for x in get_all("/journal_cats.json")}
if "1202003" not in acc:
    d = req("POST", "/journal_accounts.json", json={"JournalAccount": {"journal_cat_id": cats["1202"], "code": "1202003", "name": "بنك STC (مؤقت)", "type": 1}})
    acc["1202003"] = int(d["id"]); print("account created 1202003 بنك STC (مؤقت) id", d["id"])
OLD, NEW = acc["1202002"], acc["1202003"]
hits = []
for j in get_all("/journals.json"):
    j = j["Journal"]
    if not str(j["description"]).startswith("[AI-"): continue
    full = (req("GET", f"/journals/{j['id']}.json").get("data") or {})["Journal"]
    if any(int(t["journal_account_id"]) == OLD for t in full["JournalTransaction"]): hits.append(full)
    time.sleep(0.2)
json.dump(hits, open("backup_1202002_journals.json", "w"), ensure_ascii=False, indent=1)
print("journals on 1202002:", len(hits), "— backup saved")
for f in hits:
    assert str(f["description"]).startswith("[AI-")
    req("DELETE", f"/journals/{f['id']}.json")
    body = {"Journal": {"date": f["date"], "number": f["number"], "currency_code": "SAR", "draft": 0,
                        "description": f["description"] + " — صُحّح: حساب STC وليس الحساب الشخصي"},
            "JournalTransaction": [{"journal_account_id": NEW if int(t["journal_account_id"]) == OLD else int(t["journal_account_id"]),
                                    "currency_debit": float(t["debit"]), "currency_credit": float(t["credit"]),
                                    "description": t["description"]} for t in f["JournalTransaction"]]}
    d = req("POST", "/journals.json", json=body, headers={"Content-Type": "application/json"})
    print("moved", f["number"], "old id", f["id"], "-> new id", d["id"]); time.sleep(0.8)
# verify
bal = {OLD: D(0), NEW: D(0)}; n = 0
for j in get_all("/journals.json"):
    full = (req("GET", f"/journals/{j['Journal']['id']}.json").get("data") or {})["Journal"]; n += 1
    for t in full["JournalTransaction"]:
        a = int(t["journal_account_id"])
        if a in bal: bal[a] += D(t["debit"]) - D(t["credit"])
    time.sleep(0.2)
print("journals now:", n, "| 1202002 personal:", bal[OLD], "| 1202003 STC:", bal[NEW])
