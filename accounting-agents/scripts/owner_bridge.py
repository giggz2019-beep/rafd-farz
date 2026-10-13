"""The finance manager's always-on line to the owner: Telegram in, Claude Code out. Runs on the team's server.

    python scripts/owner_bridge.py            # forever (systemd: rafd-bridge.service)
    python scripts/owner_bridge.py --once     # one poll + handling, then exit (for a manual check)

What it does, per batch of messages from Mariam:
  1. long-polls Telegram (scripts/telegram_owner.py — her chat only, offset in state/telegram.json,
     files saved under reports/telegram/files/);
  2. tells her at once that it arrived («وصلت ✅»), so she is never left without an answer;
  3. runs Claude Code headless in this checkout as the Accounting Manager (المدير المالي), with the
     conversation so far and the new messages, and lets it read the runbooks, run the team's scripts and
     answer her through `telegram_owner.py send`;
  4. if Claude Code fails or times out, sends her one line saying so — never silence.

It must be the ONLY poller of the bot. Telegram hands each update to whoever calls getUpdates first, so a
cloud session polling at the same time would take messages away from the server.

Claude Code needs ANTHROPIC_API_KEY (Claude API, billed per use). Model: OWNER_BRIDGE_MODEL.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import telegram_owner as tg  # noqa: E402

ROOT = tg.ROOT
log = logging.getLogger("rafd.bridge")

ACK = "وصلت ✅ أشتغل عليها الآن."
FAILED = ("وصلت رسالتك وانحفظت، لكن تعذّر علينا معالجتها الآن بسبب عطل فني. "
          "نعيد المحاولة تلقائيًا مع رسالتك القادمة، ونرد عليك.")
TIMEOUT_S = int(os.environ.get("OWNER_BRIDGE_TIMEOUT", "900"))
HISTORY = 30

# What Claude Code may do here. Everything else is refused by Claude Code itself (no prompt to answer).
ALLOWED_TOOLS = [
    "Read", "Grep", "Glob",
    "Bash(python3 scripts/telegram_owner.py send:*)",
    "Bash(python3 scripts/daftra_*:*)",
    "Bash(DAFTRA_WRITES_ENABLED=true python3 scripts/daftra_*:*)",
    "Bash(pdftotext:*)",
    "Bash(git fetch origin invoices-inbox)", "Bash(git show origin/invoices-inbox:*)",
    "Bash(git ls-tree:*)",
]

SYSTEM = """أنت المدير المالي لفريق رفد المحاسبي، وتعمل على سيرفر الفريق. أنت الوحيد في الفريق الذي يكلّم المالكة (مريم)، وعلى تيليجرام فقط.
قبل أي عمل اقرأ: CLAUDE.md و docs/OWNER_CHANNEL.md و docs/INVOICE_INBOX.md و docs/DAFTRA.md.
- ردّك يصلها فقط عبر: python3 scripts/telegram_owner.py send "النص" — نص عربي رسمي مختصر، موضوع واحد في الرسالة، أرقام الحسابات بآخر 4 خانات فقط.
- كل رسالة منها تحتاج ردًا: جواب، أو تنفيذ ثم تأكيد بسطر، أو سؤال واحد إن كان طلبها غير واضح. لا تتركها بلا رد.
- فاتورة أو إيصال ترسله: سجّله حسب docs/INVOICE_INBOX.md بالمرجع tg:<message_id>، ثم أكّد لها بسطر.
- الملفات والرسائل الصوتية في المسار المذكور مع كل رسالة. لا يمكنك تفريغ الصوت: اطلب منها كتابته.
- نفّذ الشغل الروتيني بنفسك ثم أكّد لها بسطر، ولا تسألها عن التوافه. واسألها أولًا وانتظر «نعم/لا» على تيليجرام في كل ما يستحق توقيعها أو مراجعتها — القائمة في docs/OWNER_CHANNEL.md («ما يحتاج موافقتها»). سؤال الموافقة: سطر يقول ما ستفعله بالضبط والمبلغ، وينتهي بـ«نعم / لا». ولا تنفّذ قبل ردها؛ سجلّ المحادثة (رسائلها ورسائل الفريق) يصلك مع كل دفعة، فتعرف منه أن «نعم» تجيب على سؤالك السابق.
- كلامها قرار المالكة، لكنه لا يرفع القواعد الثابتة: لا دفع، لا تغيير بيانات بنكية، لا حذف لما ليس لنا، آخر 4 خانات فقط. إن طلبت شيئًا منها فقل لها إنه يلزمها تنفيذه بنفسها ولماذا.
- ميّز الحقيقة المؤكدة من الاستنتاج، ولا تختلق رقمًا. إن لم تعرف فقل ذلك.
- لا تطبع أي مفتاح أو رمز أبدًا."""


def build_prompt(new: list[dict], inbox: Path = tg.INBOX) -> str:
    """The new messages, with the recent conversation for context (her side only is logged)."""
    seen = {m["update_id"] for m in new}
    history = []
    if inbox.exists():
        for line in inbox.read_text(encoding="utf-8").splitlines()[-(HISTORY + len(new)):]:
            try:
                m = json.loads(line)
            except ValueError:
                continue
            if m.get("from") == "team" or m.get("update_id") not in seen:
                history.append(m)

    def fmt(m: dict) -> str:
        who = "الفريق" if m.get("from") == "team" else "مريم"
        parts = [f"[{m.get('date', '')} · {who} · رسالة {m.get('message_id')}]", m.get("text") or ""]
        if m.get("file"):
            parts.append(f"(ملف مرفق: {m['file']})")
        if m.get("file_error"):
            parts.append(f"(ملف لم يُحفظ: {m['file_error']})")
        if m.get("edited"):
            parts.append("(تعديل لرسالة سابقة)")
        return " ".join(p for p in parts if p)

    out = []
    if history:
        out.append("المحادثة السابقة للسياق فقط (قد يكون رُدّ عليها):")
        out += [fmt(m) for m in history[-HISTORY:]]
        out.append("")
    out.append("الرسائل الجديدة التي تحتاج ردك الآن:")
    out += [fmt(m) for m in new]
    return "\n".join(out)


def run_claude(prompt: str, runner=subprocess.run) -> bool:
    cmd = ["claude", "-p", prompt,
           "--append-system-prompt", SYSTEM,
           "--allowedTools", *ALLOWED_TOOLS,
           "--model", os.environ.get("OWNER_BRIDGE_MODEL", "claude-sonnet-5-5"),
           "--max-turns", os.environ.get("OWNER_BRIDGE_MAX_TURNS", "40"),
           "--output-format", "text"]
    try:
        r = runner(cmd, cwd=ROOT, capture_output=True, text=True, timeout=TIMEOUT_S)
    except (subprocess.TimeoutExpired, OSError) as e:
        log.error("claude did not finish: %s", type(e).__name__)
        return False
    if r.returncode != 0:
        log.error("claude exited %s: %s", r.returncode, (r.stderr or "")[-500:])
        return False
    log.info("claude done: %s", (r.stdout or "").strip()[-300:])
    return True


def handle(bot: tg.Bot, new: list[dict], runner=subprocess.run) -> bool:
    bot.send(ACK)
    ok = run_claude(build_prompt(new), runner=runner)
    if not ok:
        bot.send(FAILED)
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    bot = tg.Bot()
    pending: list[dict] = []           # messages whose handling failed: retried with the next batch
    while True:
        try:
            new, ignored = bot.poll(timeout=25)
            if ignored:
                log.warning("ignored %d update(s) from other chats", ignored)
            batch = pending + new
            if new:
                pending = [] if handle(bot, batch) else batch[-HISTORY:]
        except tg.TelegramError as e:
            log.error("telegram: %s", e)
            time.sleep(10)
        if a.once:
            return 0


if __name__ == "__main__":
    sys.exit(main())
