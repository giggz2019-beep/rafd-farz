#!/usr/bin/env bash
# RAFD accounting team — server setup (Ubuntu 24.04). Run ONCE as root from the hosting panel's console:
#
#   curl -fsSL https://raw.githubusercontent.com/giggz2019-beep/rafd-farz/accounting-agents/accounting-agents/deploy/server-setup.sh -o setup.sh && sudo bash setup.sh
#
# (If the repository is private that URL answers 404 — then paste this file's contents into setup.sh instead.)
#
# What it does, and nothing else:
#   - creates a locked system user `rafd` that owns everything below /opt/rafd;
#   - makes a deploy key, asks you to add it to GitHub (read-only), clones the `accounting-agents` branch;
#   - installs Python deps, poppler (pdftotext) and Claude Code;
#   - asks for the three secrets (typed, never shown, stored in /opt/rafd/env mode 600 — never in git);
#   - starts two systemd units: rafd-bridge (the Telegram line, always on) and rafd-update (pulls code
#     every 10 minutes and restarts the bridge when it changed);
#   - firewall: SSH only. Nothing listens on the internet — the bridge only makes outgoing calls.
# Safe to re-run: every step checks before it acts; existing secrets are kept unless you retype them.
set -euo pipefail

BRANCH=accounting-agents
REPO_SSH=git@github.com:giggz2019-beep/rafd-farz.git
BASE=/opt/rafd
APP=$BASE/repo/accounting-agents
DATA=$BASE/data
ENVF=$BASE/env

[ "$(id -u)" = 0 ] || { echo "شغّله بصلاحية root: sudo bash setup.sh"; exit 1; }
. /etc/os-release; [ "${ID:-}" = ubuntu ] || echo "تنبيه: النظام ليس Ubuntu (${ID:-?}) — نكمل، لكن قد تختلف الحزم."

echo "== 1/7 الحزم"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git python3-venv python3-pip poppler-utils ufw curl ca-certificates >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

echo "== 2/7 المستخدم rafd"
id rafd >/dev/null 2>&1 || useradd --system --home-dir $BASE --create-home --shell /usr/sbin/nologin rafd
install -d -o rafd -g rafd -m 750 $BASE $DATA $BASE/.ssh

echo "== 3/7 مفتاح GitHub (قراءة فقط)"
if [ ! -f $BASE/.ssh/id_ed25519 ]; then
  sudo -u rafd ssh-keygen -q -t ed25519 -N "" -C "rafd-accounting-server" -f $BASE/.ssh/id_ed25519
fi
sudo -u rafd bash -c "ssh-keyscan -t ed25519 github.com >> $BASE/.ssh/known_hosts 2>/dev/null; sort -u -o $BASE/.ssh/known_hosts $BASE/.ssh/known_hosts"
until sudo -u rafd git ls-remote --heads "$REPO_SSH" "$BRANCH" >/dev/null 2>&1; do
  echo
  echo "أضيفي هذا المفتاح في GitHub:  المستودع rafd-farz ← Settings ← Deploy keys ← Add deploy key"
  echo "العنوان: rafd-accounting-server — واتركي «Allow write access» بدون صح."
  echo
  cat $BASE/.ssh/id_ed25519.pub
  echo
  read -rp "بعد الإضافة اضغطي Enter… " _
done

echo "== 4/7 الكود"
if [ ! -d $BASE/repo/.git ]; then
  sudo -u rafd git clone -q --branch "$BRANCH" --single-branch "$REPO_SSH" $BASE/repo
else
  sudo -u rafd git -C $BASE/repo pull -q --ff-only
fi
sudo -u rafd git -C $BASE/repo fetch -q origin invoices-inbox:refs/remotes/origin/invoices-inbox || true
# first start continues from the offset the cloud sessions left, so no old message is re-handled
if [ ! -f $DATA/state/telegram.json ] && [ -f $APP/state/telegram.json ]; then
  sudo -u rafd install -D -m 640 $APP/state/telegram.json $DATA/state/telegram.json
fi
if [ ! -f $DATA/reports/telegram/inbox.jsonl ] && [ -f $APP/reports/telegram/inbox.jsonl ]; then
  sudo -u rafd install -D -m 640 $APP/reports/telegram/inbox.jsonl $DATA/reports/telegram/inbox.jsonl
fi

echo "== 5/7 Python و Claude Code"
[ -x $BASE/venv/bin/python ] || sudo -u rafd python3 -m venv $BASE/venv
sudo -u rafd $BASE/venv/bin/pip install -q --upgrade pip
sudo -u rafd $BASE/venv/bin/pip install -q -r $APP/requirements.txt
command -v claude >/dev/null || npm install -g --silent @anthropic-ai/claude-code

echo "== 6/7 المفاتيح (تُكتب ولا تظهر على الشاشة)"
touch $ENVF; chown root:rafd $ENVF; chmod 640 $ENVF
setkey() {  # name, prompt — keeps the stored value when Enter is pressed on an existing one
  local name=$1 prompt=$2 cur val
  cur=$(grep -E "^$name=" $ENVF | cut -d= -f2- || true)
  while :; do
    read -rsp "$prompt${cur:+ (Enter للإبقاء على الحالي)}: " val; echo
    [ -z "$val" ] && val=$cur
    [ -n "$val" ] && break
    echo "مطلوب."
  done
  sed -i "/^$name=/d" $ENVF; printf '%s=%s\n' "$name" "$val" >> $ENVF
}
setkey TELEGRAM_BOT_TOKEN "رمز بوت تيليجرام (من BotFather)"
setkey ANTHROPIC_API_KEY  "مفتاح Claude API (console.anthropic.com)"
setkey DAFTRA_API_KEY     "مفتاح دفترة (rafd1 ← الإعدادات ← API)"
for kv in "RAFD_DATA_DIR=$DATA" "DAFTRA_BASE_URL=https://rafd1.daftra.com" "DAFTRA_WRITES_ENABLED=true" \
          "OWNER_BRIDGE_MODEL=claude-sonnet-5-5" "COMPANY_VAT_REGISTERED=false" "HOME=$BASE" \
          "PATH=$BASE/venv/bin:/usr/local/bin:/usr/bin:/bin" "DISABLE_AUTOUPDATER=1"; do
  grep -q "^${kv%%=*}=" $ENVF || echo "$kv" >> $ENVF
done
sudo -u rafd env $(grep -E '^(TELEGRAM_BOT_TOKEN|RAFD_DATA_DIR)=' $ENVF | xargs) \
  $BASE/venv/bin/python $APP/scripts/telegram_owner.py check || { echo "رمز البوت غير صحيح — أعيدي التشغيل"; exit 1; }

echo "== 7/7 الخدمات والجدار الناري"
cat > /etc/systemd/system/rafd-bridge.service <<EOF
[Unit]
Description=RAFD finance manager — Telegram line to the owner
After=network-online.target
Wants=network-online.target

[Service]
User=rafd
WorkingDirectory=$APP
EnvironmentFile=$ENVF
ExecStart=$BASE/venv/bin/python scripts/owner_bridge.py
Restart=always
RestartSec=10
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$BASE
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/rafd-update.service <<EOF
[Unit]
Description=RAFD — pull the accounting-agents branch, restart the bridge if it changed

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'before=\$(sudo -u rafd git -C $BASE/repo rev-parse HEAD); \
  sudo -u rafd git -C $BASE/repo pull -q --ff-only && \
  sudo -u rafd git -C $BASE/repo fetch -q origin invoices-inbox:refs/remotes/origin/invoices-inbox; \
  [ "\$(sudo -u rafd git -C $BASE/repo rev-parse HEAD)" = "\$before" ] || { \
    sudo -u rafd $BASE/venv/bin/pip install -q -r $APP/requirements.txt; systemctl restart rafd-bridge; }'
EOF
cat > /etc/systemd/system/rafd-update.timer <<EOF
[Unit]
Description=RAFD — code update every 10 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=10min

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now rafd-bridge.service rafd-update.timer
ufw allow OpenSSH >/dev/null; ufw --force enable >/dev/null

sleep 3
systemctl is-active --quiet rafd-bridge && echo "✅ تم. البوت شغّال — أرسلي له رسالة في تيليجرام للتجربة." \
  || { echo "❌ الخدمة لم تعمل:"; journalctl -u rafd-bridge -n 30 --no-pager; exit 1; }
echo "السجل: journalctl -u rafd-bridge -f"
