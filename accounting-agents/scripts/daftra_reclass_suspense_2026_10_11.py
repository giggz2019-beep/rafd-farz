"""Clear the suspense account 1211 by tagged reclass entries. --commit to post; default is a dry run."""
import httpx, json, sys, time, unicodedata
from decimal import Decimal as D
from collections import Counter, defaultdict
COMMIT = "--commit" in sys.argv
TAG = "AI-RECLASS-2026-10-11"
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
NEW = {"5212": ("مصروف رواتب وأجور", "52", 1), "215": ("دفعات شركاء تحت التسجيل", "21", 0)}
for code, (name, cat, typ) in NEW.items():
    if code not in acc:
        if COMMIT:
            d = req("POST", "/journal_accounts.json", json={"JournalAccount": {"journal_cat_id": cats[cat], "code": code, "name": name, "type": typ}})
            acc[code] = int(d["id"]); print("account created", code, name, d["id"])
        else:
            acc[code] = -1; print("would create", code, name)
SUS, CARD = acc["1211"], acc["120102"]
journals = [x["Journal"] for x in get_all("/journals.json")]
nums = {str(j["number"]) for j in journals}
def rule(desc, other):
    n = unicodedata.normalize("NFKC", desc)
    if other == CARD: return "33", "مصروف بطاقة بلا مستند للشركة → جاري المالكة"
    if "UltaHost" in n: return "120102", "دُفعت عبر PayPal بالبطاقة 1146 (تقديري حتى كشف أكتوبر)"
    if "PAYROLL" in n: return "33", "راتب المالكة نزل في حساب الشركة → جاري المالكة"
    if "MESHARI" in n or "7239FR" in n: return "215", "دفعة شريك تحت التسجيل (مشاري / الخليفي)"
    if "SMALL MEDIUM" in n: return "4201", "دفعة من هيئة المنشآت → إيرادات أخرى"
    if "Network" in n or "NETWORK" in n: return "413", "تسوية بوابة دفع Network → إيرادات الخدمات"
    if "8075FR" in n or "4671FR" in n or "RAYAN" in n or "35.00 SAR" in n: return "413", "دفعة عميل 35 ريال → إيرادات الخدمات"
    if "أبشر" in n: return "5206", "تحويل لأبشر → مصاريف حكومية"
    if "5614TO" in n or "AJESH" in n: return "33", "تحويل لشخص بلا مستند للشركة → جاري المالكة"
    return None, None
plan, left, by = [], [], Counter()
for j in journals:
    if not str(j["description"]).startswith("[AI-"): continue
    d = req("GET", f"/journals/{j['id']}.json"); jj = (d.get("data") or d)["Journal"]
    lines = jj["JournalTransaction"]
    s = [t for t in lines if int(t["journal_account_id"]) == SUS]
    if not s: continue
    other = [int(t["journal_account_id"]) for t in lines if int(t["journal_account_id"]) != SUS][0]
    amt = D(s[0]["debit"]) - D(s[0]["credit"])          # + suspense was debited
    target, why = rule(jj["description"], other)
    if not target: left.append((jj["number"], jj["description"][:90], amt)); continue
    by[why] += 1
    plan.append({"orig": jj["number"], "date": jj["date"], "amt": abs(amt), "target": target, "why": why,
                 "dr": target if amt > 0 else "1211", "cr": "1211" if amt > 0 else target, "desc": jj["description"]})
    time.sleep(0.25)
# entries that never reached the books: the owner's own transfers to the STC account and the salaries paid from it
extra = [("2026-08-05", "1202002", "33", "209.00", "تحويل من المالكة لحساب STC"), ("2026-08-05", "1202002", "33", "2340.00", "تحويل من المالكة لحساب STC"),
         ("2026-08-29", "1202002", "33", "1260.00", "تحويل من المالكة لحساب STC")]
for dt in ("2026-08-31", "2026-09-02", "2026-10-07", "2026-10-08"):
    extra.append((dt, "5212", "1202002", "2500.00", "راتب المالكة كمؤسِّسة — صُرف من حساب STC"))
for k, v in by.items(): print(f"{v:3d}  {k}")
print("left in suspense:", left)
bal = defaultdict(D)
for p in plan: bal[p["dr"]] += p["amt"]; bal[p["cr"]] -= p["amt"]
print("suspense movement from reclass:", bal["1211"], "| extra entries:", len(extra))
if not COMMIT: sys.exit(0)
posted = 0
for i, p in enumerate(plan, 1):
    number = f"AI20261011-R{p['orig'][-4:]}"
    if number in nums: continue
    body = {"Journal": {"date": p["date"], "description": f"[{TAG}] تسوية {p['orig']}: {p['why']}", "number": number, "currency_code": "SAR", "draft": 0},
            "JournalTransaction": [{"journal_account_id": acc[p["dr"]], "currency_debit": float(p["amt"]), "currency_credit": 0, "description": p["why"]},
                                   {"journal_account_id": acc[p["cr"]], "currency_debit": 0, "currency_credit": float(p["amt"]), "description": p["why"]}]}
    req("POST", "/journals.json", json=body, headers={"Content-Type": "application/json"}); posted += 1; time.sleep(0.8)
for i, (dt, dr, cr, a, why) in enumerate(extra, 1):
    number = f"AI20261011-X{i:03d}"
    if number in nums: continue
    body = {"Journal": {"date": dt, "description": f"[{TAG}] {why}", "number": number, "currency_code": "SAR", "draft": 0},
            "JournalTransaction": [{"journal_account_id": acc[dr], "currency_debit": float(a), "currency_credit": 0, "description": why},
                                   {"journal_account_id": acc[cr], "currency_debit": 0, "currency_credit": float(a), "description": why}]}
    req("POST", "/journals.json", json=body, headers={"Content-Type": "application/json"}); posted += 1; time.sleep(0.8)
print("posted", posted)
