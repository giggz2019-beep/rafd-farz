# Talking to the owner: Telegram only

Since 2026-10-12, the accounting team reaches Mariam through **Telegram**. **WhatsApp is no longer used for this, at all.**

- Bot: **@RafdAccountingTeamBot** («فريق رفد المحاسبي»).
- The bot sends to one chat only, hers: `chat_id 864934458`.
- Tool: `scripts/telegram_owner.py` (`send`, `poll`, `check`).

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
1. At the start of every shift, run `python scripts/telegram_owner.py poll`.
   - It returns only messages from her chat. Updates from other chats are dropped unread.
   - Each of her messages is appended to `reports/telegram/inbox.jsonl`.
   - The offset is saved in `state/telegram.json`.
   - Commit both files with the shift's work.
2. Treat each reply as the owner's decision on the question it answers, and carry it out in the same shift.
   - Example: «للشركة» moves an item off suspense to the account it now belongs to.
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
