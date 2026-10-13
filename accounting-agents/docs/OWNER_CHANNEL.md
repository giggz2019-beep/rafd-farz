# Talking to the owner: Telegram only, through the Accounting Manager only

Since 2026-10-12, the accounting team reaches Mariam through **Telegram**. **WhatsApp is no longer used for this, at all.**

- Bot: **@RafdAccountingTeamBot** («فريق رفد المحاسبي»).
- The bot sends to one chat only, hers: `chat_id 864934458`.
- Tool: `scripts/telegram_owner.py` (`send`, `poll`, `check`).

## The rule (the owner, 2026-10-12)

> «هي القناة الوحيدة … المدير المالي فقط هو يتواصل معي، تبغون شيء بلغوه ويتواصل معي»

1. **Telegram is the ONLY channel between the team and the owner, both ways.** Every approval, every
   report, every question, every request — and everything she sends the team, including invoices and
   receipts that never reached the bank feed or the email inbox. No email to her, no WhatsApp, no other
   chat, and an approval given anywhere else is not an approval.
2. **Only the Accounting Manager (المدير المالي, `accounting_manager`) talks to her.** No other agent
   calls `telegram_owner.py send`, and no other agent reads her messages and acts on them alone.
   - An agent that needs something from her — an approval, an answer, a document — puts it to the
     Accounting Manager, who decides whether it goes, merges it with anything else pending, and sends it.
   - Her replies and files come back to the Accounting Manager, who hands each one to the agent that
     owns it (an invoice to Expense / Accounts Payable, a VAT question to the VAT Accountant, …) and
     answers her himself.
   - One voice: she should never get two messages about the same thing, or a message from an agent
     she did not hear about through him.

## What goes to her
Anything that needs her goes to her on Telegram:
- a question,
- an alert (a VAT threshold, a payment due, something that looks wrong),
- the report from a shift that posted something or has a question open.

How to write it:
- Short, clear, formal Arabic.
- One subject per message.
- Numbers in full, but an account appears as its last 4 digits only.
- Lead with what is needed from her. A question she can answer in a word is better than an explanation.
- Don't send anything that needs nothing from her: a shift with nothing new sends nothing.
- Never send a token, a full IBAN or account number, or the contents of an email.

## What comes back from her
1. At the start of every shift, the Accounting Manager runs `python scripts/telegram_owner.py poll`.
   - It returns only messages from her chat. Updates from other chats are dropped unread.
   - Each of her messages is appended to `reports/telegram/inbox.jsonl`.
   - A file she attaches (an invoice PDF, a photo of a receipt) is saved under
     `reports/telegram/files/<message_id>-<name>`, and the log line carries its path as `file`.
     If it could not be fetched (over Telegram's 20 MB limit for bots, a network error) the line
     carries `file_error` instead — ask her to send it again, smaller or as a PDF.
   - The offset is saved in `state/telegram.json`.
   - Commit the log, the state and the saved files with the shift's work.
2. Treat each reply as the owner's decision on the question it answers, and carry it out in the same shift.
   - Example: «للشركة» moves an item off suspense to the account it now belongs to.
   - An invoice or receipt she sends is posted under `docs/INVOICE_INBOX.md`'s rules, with
     `--ref tg:<message_id>`, so the same file sent twice is posted once.
3. Then confirm back to her in one line.
4. Her word never overrides the standing rules:
   - no payments,
   - no change to bank details,
   - no deleting anything that is not ours,
   - last 4 digits only.

   If a reply asks for one of these, tell her it needs her to do it herself, and say why.
5. If a reply is ambiguous, ask once more on Telegram. Do not guess.

## Setup (one time, done by the owner)
- **Token:** add `TELEGRAM_BOT_TOKEN` as an environment variable in the cloud environment's settings, so scheduled runs have it too.
  - On a local machine it can instead live in `accounting-agents/.env`, which is git-ignored.
  - Never put the token in the chat, a commit, a report or any output.
- **Network:** the environment's network policy must allow `api.telegram.org`.
- **Webhook:** there is none; the n8n workflow that used one is switched off. If a webhook ever comes back, `getUpdates` answers 409, and the tool calls `deleteWebhook` once and retries.

## ما يحتاج موافقتها (the owner, 2026-10-13)
> «إذا في حاجة تحتاج توقيع، تحتاج مراجعة… يرجع لي يسألني وأنا أعطيه الأوكي على التليجرام إيه أو لا… مو بكل الأشياء يرجع لي، أشياء تافهة لا».

**Done without asking, then confirmed to her in one line:** answering her questions; reports and totals; posting
an invoice or receipt she sent herself when the account and the payer are clear and it is **1,000 SAR or less**
(`PURCHASE_APPROVAL_THRESHOLD`); routine scheduled postings under `docs/INVOICE_INBOX.md` within that limit;
parking anything unclear in suspense 1211 with a question.

**Asked first — one line saying exactly what will be done and the amount, ending «نعم / لا» — and done only
after her «نعم»:**
- any single posting **over 1,000 SAR**, or anything she asked to have reviewed;
- a new vendor, a contract, a purchase order;
- reclassifying, reversing or correcting an entry already posted;
- anything charged to her current account 33 that she did not state herself;
- payroll, GOSI and every tax decision (VAT registration, a return, an exemption claim);
- anything that will carry her signature or goes to a government body, a bank or a client.

Still never, whatever the answer: paying, changing bank details, deleting what is not ours, printing more than
the last 4 digits of an account.

## The server (since 2026-10-13)
The finance manager now runs on the team's own server (UltaHost, Saudi Arabia, Ubuntu 24.04): `deploy/server-setup.sh`
installs it once, `rafd-bridge` answers her on Telegram the moment she writes (`scripts/owner_bridge.py` → Claude
Code headless in the checkout), and `rafd-update` pulls this branch every 10 minutes. Its live data — offset,
conversation log, her files — is in `/opt/rafd/data`, **not** in the repo.

**Once the server is live, a cloud session must NOT run `telegram_owner.py poll`.** Telegram gives each message to
whoever asks first, so a second poller steals messages from the server. A cloud session that needs to reach her
sends through `send` only, or asks the server.
