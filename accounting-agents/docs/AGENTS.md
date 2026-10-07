# The ten agents

Generated from `app/agents/roster.py` and `app/security/permissions.py` — regenerate rather than edit by hand.

Each agent's system prompt is `app/agents/prompts/<role>.md`.

| # | Agent | Responsibility | Tools (via gateway) | Owner-approval operations |
|---|---|---|---|---|
| 1 | **Accounting Manager** (`accounting_manager`) | Coordinates the other agents, applies the posting policy, resolves conflicts, and is the only agent that posts to the staging ledger. Escalates anything uncertain to the owner. | `daftra.list_journals`, `daftra.write_journal`, `documents.verify`, `ledger.balances`, `ledger.post_staging`, `ledger.reverse_entry` | reverse_or_delete_entry, write_daftra |
| 2 | **Revenue Accountant** (`revenue_accountant`) | Recognises revenue from sales invoices: picks the revenue account and immediate vs deferred recognition, then has the deterministic tool build the entry. | `documents.verify`, `ledger.balances`, `revenue.propose_entry` | — |
| 3 | **Expense Accountant** (`expense_accountant`) | Classifies purchase invoices to the chart of accounts and has the deterministic tool build the entry. | `documents.verify`, `expense.propose_entry`, `ledger.balances` | — |
| 4 | **Accounts Receivable** (`accounts_receivable`) | Tracks what customers owe: registers sales invoices, produces the aging report, drafts (never sends) collection reminders. | `receivables.aging`, `receivables.register` | — |
| 5 | **Accounts Payable** (`accounts_payable`) | Tracks what the company owes: registers purchase invoices and requests vendor payments. Every payment needs the owner's approval. | `payables.execute_payment`, `payables.register` | execute_payment |
| 6 | **Payroll Accountant** (`payroll_accountant`) | Computes payroll and GOSI deductions and prepares the payroll entry. Paying salaries needs the owner's approval. | `payroll.compute`, `payroll.pay` | execute_payroll_payment |
| 7 | **Saudi VAT Accountant** (`vat_accountant`) | Validates VAT on every invoice, monitors the registration threshold, and prepares VAT returns. Filing is done by the owner on the ZATCA portal after approval. | `vat.prepare_return`, `vat.submit_return`, `vat.validate_invoice` | submit_tax_return |
| 8 | **Bank Reconciliation** (`bank_reconciliation`) | Matches bank statement lines to booked cash movements and explains the differences. | `bank.reconcile`, `bank.update_account`, `daftra.list_journals`, `ledger.balances` | modify_bank_account |
| 9 | **Financial Analyst** (`financial_analyst`) | Produces the financial statements from the ledger and a plain-language commentary for the owner. | `daftra.list_journals`, `ledger.balances`, `reports.financials` | — |
| 10 | **Internal Audit** (`internal_audit`) | Independently reviews every proposed entry: duplicates, documentation, VAT, double-entry integrity, and the audit-log chain. Can block; cannot post, pay, or approve. | `audit.review_entry`, `audit.verify_chain`, `daftra.list_journals`, `documents.verify`, `invoices.check_duplicate`, `ledger.balances` | — |
