# Purchase recovery

Migration 0078 adds transactional fulfillment and verified delivery receipts.
Deploy it before the matching rc-webhook and receipt-aware client. Do not use
old iap_purchases.status='credited' alone as proof of delivery: old workers wrote
that status before crediting. The migration backfills only rows proven by a
matching gem ledger entry. Currency and the new verified marker commit together.

The client journals store transaction ID, product and owning account locally.
After checkout it polls the account's verified receipt, not its gem balance.
Foreground/shop wallet refresh retries pending entries. Receipts cannot credit
currency, and a different account cannot adopt the pending purchase.

Check store transaction identifiers in RevenueCat sandbox on both platforms.
StoreKit test identifiers can differ from webhook identifiers; unmatched IDs
remain pending rather than guessing a delivery from amount or time. A device
storage failure or crash between checkout and journaling can still require
support lookup. This is not a complete receipt-restoration service.

Refund/uncancellation/transfer events are durably deduplicated in
public.iap_review_events before acknowledging them. Failed recording returns 500
for retry. Review unresolved rows daily before enabling paid acquisition.

Operator procedure:
1. Verify the event against the store/RevenueCat and the original receipt.
2. Inspect that transaction's gem ledger and subsequent exchanges/spending.
3. For an account transfer, never mint a second copy of consumed gems. Reconcile
   entitlement ownership and any unspent value under an approved support policy.
4. For a refund, determine the recoverable balance; do not make wallets negative
   or silently confiscate unrelated winnings. Record any adjustment as a new,
   idempotent ledger transaction referencing the review event.
5. Record resolved_at and a factual resolution after reconciliation succeeds.

Automatic clawback and entitlement-transfer execution are not implemented.
They require a product/support policy for spent currency and ownership disputes.
The review queue prevents silent loss of these events while that policy is set.
