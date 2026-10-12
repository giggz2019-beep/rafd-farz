"""READ-ONLY re-pull and compare against baseline/balances.json.

Usage: python3 compare.py [--save DIR]
Exit code 0 = all per-code nets identical and module totals tie to the ledger; 1 otherwise.
Checks:
  1. per-account-code debit/credit/net vs baseline (nets must be IDENTICAL; gross debit/credit
     may legitimately move if a journal is replaced by a module record that posts the same net)
  2. 1202001 = 71,245.47; 1202002 has no lines; 1211 = 0; every journal balanced; dup numbers
  3. Expenses / Incomes module totals by category, by month, by treasury, and vs ledger 52xx
  4. Revenue tie-out (updated 2026-10-12, revenue accountant): ledger ALL 4xxx accounts =
     sales invoices (non-draft) + Incomes module, in total and by month; invoices fully paid;
     client receivable sub-accounts (1204xxxx) net 0.
  Revenue accounts (4xxx) may move between each other (e.g. 413 -> 411 when an income becomes a
  sales invoice); their GROUP net must equal the baseline group net. Every other code is strict.
"""
import json, os, sys
from collections import defaultdict, Counter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pull import pull_everything, balances, account_map, lines_of, get_all

HERE = os.path.dirname(os.path.abspath(__file__))
base = json.load(open(os.path.join(HERE, "baseline", "balances.json")))
d = pull_everything()
d["invoices"] = get_all("invoices")
d["invoice_payments"] = get_all("invoice_payments")
if "--save" in sys.argv:
    out = sys.argv[sys.argv.index("--save") + 1]
    os.makedirs(out, exist_ok=True)
    for k, v in d.items():
        json.dump(v, open(os.path.join(out, f"{k}.json"), "w"), ensure_ascii=False, indent=1)

journals, accounts = d["journals"], d["journal_accounts"]
amap = account_map(accounts)
now = balances(journals, accounts)
ok = True
r2 = lambda x: round(float(x or 0), 2)

print("=== 1. Per-account-code balances vs baseline ===")
print(f"{'code':<9}{'name':<34}{'base net':>13}{'now net':>13}{'diff':>11}  gross dr/cr change")
for code in sorted(set(base) | set(now)):
    b = base.get(code, {"name": "", "debit": 0, "credit": 0, "net": 0})
    n = now.get(code, {"name": b["name"], "debit": 0, "credit": 0, "net": 0})
    dn = r2(n["net"] - b["net"])
    gross = f"dr {r2(n['debit']-b['debit']):+.2f} cr {r2(n['credit']-b['credit']):+.2f}"
    is_rev = code.startswith("4")
    flag = "" if dn == 0 else ("  (reclass within revenue — checked as a group below)" if is_rev else "  <-- NET CHANGED")
    if dn and not is_rev: ok = False
    print(f"{code:<9}{(n['name'] or '')[:32]:<34}{b['net']:>13,.2f}{n['net']:>13,.2f}{dn:>11,.2f}  {gross}{flag}")

grp = lambda src: r2(sum(v["net"] for k, v in src.items() if k.startswith("4")))
gb, gn = grp(base), grp(now)
print(f"revenue group (all 4xxx) net: base {gb:,.2f} now {gn:,.2f} {'OK' if gb == gn else 'FAIL'}"); ok &= gb == gn

print("\n=== 2. Integrity ===")
j1 = r2(now.get("1202001", {}).get("net"))
print(f"1202001 net = {j1:,.2f} (must be 71,245.47) {'OK' if j1 == 71245.47 else 'FAIL'}"); ok &= j1 == 71245.47
pers = now.get("1202002")
print(f"1202002 owner personal: {'no lines OK' if not pers or (pers['debit']==0 and pers['credit']==0) else 'FAIL ' + str(pers)}")
ok &= not pers or (pers["debit"] == 0 and pers["credit"] == 0)
s = r2(now.get("1211", {}).get("net"))
print(f"1211 suspense net = {s:,.2f} {'OK' if s == 0 else 'FAIL'}"); ok &= s == 0
unbal = [j["Journal"]["id"] for j in journals
         if r2(sum(float(t.get("currency_debit") or 0) for t in lines_of(j))) != r2(sum(float(t.get("currency_credit") or 0) for t in lines_of(j)))]
print(f"journals: {len(journals)} total; tagged [AI-: {sum(1 for j in journals if (j['Journal']['description'] or '').startswith('[AI-'))}; "
      f"automatic (module-generated): {sum(1 for j in journals if j['Journal'].get('is_automatic') == '1')}; unbalanced: {unbal or 'none'}")
ok &= not unbal
dups = {k: v for k, v in Counter(j["Journal"]["number"] for j in journals).items() if v > 1}
print(f"duplicate journal numbers: {dups or 'none'}")
pid = {i for i, a in amap.items() if a["code"] == "1202002"}
bad = [j["Journal"]["id"] for j in journals if any(str(t["journal_account_id"]) in pid for t in lines_of(j))]
if bad: print("journals on 1202002:", bad); ok = False

print("\n=== 3. Modules ===")
def summarize(recs, key):
    by_cat, by_month, by_tre, total, n = defaultdict(float), defaultdict(float), defaultdict(float), 0.0, 0
    for rec in recs:
        R = rec.get(key, rec)
        amt = float(R.get("amount") or 0)
        cat = R.get("category") or f"cat_id={R.get('expense_category_id')}" or "?"
        by_cat[cat] += amt; by_month[(R.get("date") or "?")[:7]] += amt
        by_tre[f"treasury {R.get('treasury_id')}"] += amt; total += amt; n += 1
    print(f"{key}: {n} records, total {total:,.2f}")
    for lbl, dd in (("by category", by_cat), ("by month", by_month), ("by treasury", by_tre)):
        print(f"  {lbl}:")
        for k in sorted(dd): print(f"    {k:<40}{dd[k]:>12,.2f}")
    return round(total, 2), {k: round(v, 2) for k, v in by_month.items()}
et, em = summarize(d["expenses"], "Expense")
it, im = summarize(d["incomes"], "Income")

# ledger totals (all journal lines, incl. module-generated ones)
lm = {"52xx": defaultdict(float), "rev": defaultdict(float)}
for j in journals:
    for t in lines_of(j):
        c = amap.get(str(t["journal_account_id"]), {}).get("code", "")
        v = float(t.get("currency_debit") or 0) - float(t.get("currency_credit") or 0)
        if c.startswith("52"): lm["52xx"][j["Journal"]["date"][:7]] += v
        elif c.startswith("4"): lm["rev"][j["Journal"]["date"][:7]] -= v
# sales invoices (non-draft) by month
inv_m, inv_t, inv_paid, inv_n = defaultdict(float), 0.0, 0.0, 0
for rec in d["invoices"]:
    I = rec.get("Invoice", rec)
    if str(I.get("draft")) == "1": continue
    dt = I.get("date") or "?"
    if "/" in dt: dd_, mm_, yy_ = dt.split("/"); dt = f"{yy_}-{mm_}-{dd_}"
    amt = float(I.get("summary_total") or 0)
    inv_m[dt[:7]] += amt; inv_t += amt; inv_paid += float(I.get("summary_paid") or 0); inv_n += 1
inv_t, inv_paid = round(inv_t, 2), round(inv_paid, 2)
pay_t = round(sum(float(p.get("InvoicePayment", p).get("amount") or 0) for p in d["invoice_payments"]), 2)
print(f"\nSales invoices: {inv_n} non-draft, total {inv_t:,.2f}, paid {inv_paid:,.2f}, unpaid {round(inv_t-inv_paid,2):,.2f}; invoice payments total {pay_t:,.2f}")
for k in sorted(inv_m): print(f"    {k:<40}{inv_m[k]:>12,.2f}")
ok &= inv_t == inv_paid == pay_t
recv = {c: v for c, v in now.items() if c.startswith("1204")}
recv_bad = {c: v["net"] for c, v in recv.items() if r2(v["net"]) != 0}
print(f"client receivables 1204xxxx: {len(recv)} accounts, non-zero: {recv_bad or 'none'}"); ok &= not recv_bad
l52, lrev = round(sum(lm["52xx"].values()), 2), round(sum(lm["rev"].values()), 2)
print(f"\nledger 52xx net = {l52:,.2f} | Expenses module = {et:,.2f} | {'TIES' if l52 == et else 'DIFF ' + format(round(l52-et,2), ',.2f')}")
rt = round(it + inv_t, 2)
print(f"ledger 4xxx net = {lrev:,.2f} | Incomes {it:,.2f} + Sales invoices {inv_t:,.2f} = {rt:,.2f} | {'TIES' if lrev == rt else 'DIFF ' + format(round(lrev-rt,2), ',.2f')}")
print("month      52xx-ledger  expenses-mod   rev-ledger  incomes+inv")
for m in sorted(set(lm["52xx"]) | set(lm["rev"]) | set(em) | set(im) | set(inv_m)):
    a, b, c, e = round(lm["52xx"].get(m, 0), 2), em.get(m, 0), round(lm["rev"].get(m, 0), 2), round(im.get(m, 0) + inv_m.get(m, 0), 2)
    print(f"{m:<10}{a:>12,.2f}{b:>14,.2f}{c:>13,.2f}{e:>13,.2f}{'' if (a == b and c == e) else '   <-- diff'}")
rev_ok = lrev == rt and all(round(lm["rev"].get(m, 0), 2) == round(im.get(m, 0) + inv_m.get(m, 0), 2) for m in set(lm["rev"]) | set(im) | set(inv_m))
exp_ok = l52 == et
print(f"\nREVENUE tie-out: {'PASS' if rev_ok else 'FAIL'} | EXPENSE tie-out: {'PASS' if exp_ok else 'FAIL'}")
ok &= exp_ok and rev_ok
print("\nRESULT:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
