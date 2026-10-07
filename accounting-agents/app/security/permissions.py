"""Role-based access control: which agent may perform which operation.

This table is the single source of truth. Agents never check permissions
themselves — the ToolGateway does, on every call — so an agent prompt that
asks for something outside its row simply gets PermissionDenied.
"""
from __future__ import annotations

from enum import Enum


class Role(str, Enum):
    ACCOUNTING_MANAGER = "accounting_manager"
    REVENUE_ACCOUNTANT = "revenue_accountant"
    EXPENSE_ACCOUNTANT = "expense_accountant"
    ACCOUNTS_RECEIVABLE = "accounts_receivable"
    ACCOUNTS_PAYABLE = "accounts_payable"
    PAYROLL_ACCOUNTANT = "payroll_accountant"
    VAT_ACCOUNTANT = "vat_accountant"
    BANK_RECONCILIATION = "bank_reconciliation"
    FINANCIAL_ANALYST = "financial_analyst"
    INTERNAL_AUDIT = "internal_audit"
    OWNER = "owner"          # the human; the only role that can approve


class Op(str, Enum):
    READ_LEDGER = "read_ledger"
    READ_DOCUMENTS = "read_documents"
    READ_DAFTRA = "read_daftra"
    PROPOSE_REVENUE_ENTRY = "propose_revenue_entry"
    PROPOSE_EXPENSE_ENTRY = "propose_expense_entry"
    CLASSIFY_EXPENSE = "classify_expense"
    MANAGE_RECEIVABLES = "manage_receivables"
    MANAGE_PAYABLES = "manage_payables"
    PREPARE_PAYROLL = "prepare_payroll"
    VALIDATE_VAT = "validate_vat"
    PREPARE_VAT_RETURN = "prepare_vat_return"
    RECONCILE_BANK = "reconcile_bank"
    GENERATE_REPORTS = "generate_reports"
    AUDIT_REVIEW = "audit_review"
    VERIFY_AUDIT_LOG = "verify_audit_log"
    RESOLVE_CONFLICT = "resolve_conflict"
    POST_TO_STAGING_LEDGER = "post_to_staging_ledger"
    REQUEST_APPROVAL = "request_approval"
    # ---- approval-gated (the owner must approve each one) ----
    EXECUTE_PAYMENT = "execute_payment"                 # financial transfer
    MODIFY_BANK_ACCOUNT = "modify_bank_account"
    SUBMIT_TAX_RETURN = "submit_tax_return"
    EXECUTE_PAYROLL_PAYMENT = "execute_payroll_payment"
    REVERSE_OR_DELETE_ENTRY = "reverse_or_delete_entry"  # destructive accounting change
    WRITE_DAFTRA = "write_daftra"
    # ---- owner only ----
    APPROVE = "approve"


APPROVAL_REQUIRED: frozenset[Op] = frozenset({
    Op.EXECUTE_PAYMENT, Op.MODIFY_BANK_ACCOUNT, Op.SUBMIT_TAX_RETURN,
    Op.EXECUTE_PAYROLL_PAYMENT, Op.REVERSE_OR_DELETE_ENTRY, Op.WRITE_DAFTRA,
})

_COMMON = {Op.READ_LEDGER, Op.READ_DOCUMENTS, Op.REQUEST_APPROVAL}

PERMISSIONS: dict[Role, frozenset[Op]] = {
    Role.ACCOUNTING_MANAGER: frozenset(_COMMON | {Op.READ_DAFTRA, Op.RESOLVE_CONFLICT,
                                                  Op.POST_TO_STAGING_LEDGER, Op.REVERSE_OR_DELETE_ENTRY,
                                                  Op.WRITE_DAFTRA}),
    Role.REVENUE_ACCOUNTANT: frozenset(_COMMON | {Op.PROPOSE_REVENUE_ENTRY}),
    Role.EXPENSE_ACCOUNTANT: frozenset(_COMMON | {Op.PROPOSE_EXPENSE_ENTRY, Op.CLASSIFY_EXPENSE}),
    Role.ACCOUNTS_RECEIVABLE: frozenset(_COMMON | {Op.MANAGE_RECEIVABLES}),
    Role.ACCOUNTS_PAYABLE: frozenset(_COMMON | {Op.MANAGE_PAYABLES, Op.EXECUTE_PAYMENT}),
    Role.PAYROLL_ACCOUNTANT: frozenset(_COMMON | {Op.PREPARE_PAYROLL, Op.EXECUTE_PAYROLL_PAYMENT}),
    Role.VAT_ACCOUNTANT: frozenset(_COMMON | {Op.VALIDATE_VAT, Op.PREPARE_VAT_RETURN, Op.SUBMIT_TAX_RETURN}),
    Role.BANK_RECONCILIATION: frozenset(_COMMON | {Op.READ_DAFTRA, Op.RECONCILE_BANK, Op.MODIFY_BANK_ACCOUNT}),
    Role.FINANCIAL_ANALYST: frozenset(_COMMON | {Op.READ_DAFTRA, Op.GENERATE_REPORTS}),
    # Audit can read everything and block, but can post, pay or approve nothing.
    Role.INTERNAL_AUDIT: frozenset(_COMMON | {Op.READ_DAFTRA, Op.AUDIT_REVIEW, Op.VERIFY_AUDIT_LOG}),
    Role.OWNER: frozenset({Op.APPROVE, Op.READ_LEDGER, Op.READ_DOCUMENTS, Op.VERIFY_AUDIT_LOG}),
}

# Sanity: no agent may hold APPROVE.
assert all(Op.APPROVE not in ops for r, ops in PERMISSIONS.items() if r != Role.OWNER)


class PermissionDenied(PermissionError):
    def __init__(self, role: Role, op: Op):
        super().__init__(f"{role.value} is not permitted to {op.value}")
        self.role, self.op = role, op


def allowed(role: Role, op: Op) -> bool:
    return op in PERMISSIONS.get(role, frozenset())


def require(role: Role, op: Op) -> None:
    if not allowed(role, op):
        raise PermissionDenied(role, op)
