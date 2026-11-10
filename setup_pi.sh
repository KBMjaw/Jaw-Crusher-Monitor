#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  Kannan Crusher Monitor — Raspberry Pi Setup Script
#  Run on the Pi as the 'pi' user:
#    cd ~/kannan_backend && bash setup_pi.sh
#
#  Prerequisites:
#    - The repo is already cloned (or rsync'd) to ~/kannan_backend
#    - requirements.txt is in the project root
# ═══════════════════════════════════════════════════════════════

set -e
PI_HOME="/home/pi"
PROJECT="${CRUSHER_BASE:-$PI_HOME/kannan_backend}"
VENV="$PROJECT/venv"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Kannan Blue Metals — Crusher Backend Setup"
echo "  Project dir: $PROJECT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── STEP 1: System packages ─────────────────────────────────────
echo ""
echo "▶ STEP 1: Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y \
  python3 python3-pip python3-venv \
  libopencv-dev python3-opencv \
  ffmpeg \
  git curl \
  libpango-1.0-0 libpangoft2-1.0-0 \
  build-essential libssl-dev libffi-dev python3-dev \
  udev

# ── STEP 2: Project directories ─────────────────────────────────
echo ""
echo "▶ STEP 2: Setting up project directories..."
mkdir -p "$PROJECT/weights"
mkdir -p "$PROJECT/logs"
mkdir -p "$PROJECT/output_frames"
mkdir -p "$PROJECT/static"

# ── STEP 3: Python virtual environment ──────────────────────────
echo ""
echo "▶ STEP 3: Creating Python venv..."
python3 -m venv "$VENV"
source "$VENV/bin/activate"
pip install --upgrade pip -q

# ── STEP 4: Install ALL backend dependencies from requirements.txt ──
echo ""
echo "▶ STEP 4: Installing Python packages from requirements.txt..."
if [ -f "$PROJECT/requirements.txt" ]; then
  pip install -r "$PROJECT/requirements.txt"
else
  echo "  ⚠️  requirements.txt not found — installing minimal set"
  pip install \
    fastapi==0.111.0 \
    "uvicorn[standard]==0.30.1" \
    python-multipart==0.0.9 \
    ultralytics==8.2.0 \
    opencv-python-headless==4.9.0.80 \
    aiofiles==23.2.1 \
    aiosqlite==0.20.0 \
    python-dotenv==1.0.1 \
    reportlab==4.2.2 \
    pymodbus==3.6.9
fi
echo "  ✅ Python packages installed"

# ── STEP 5: .env file ───────────────────────────────────────────
echo ""
echo "▶ STEP 5: Setting up .env..."
if [ -f "$PROJECT/.env" ]; then
  echo "  ✓ .env already exists — not overwriting"
elif [ -f "$PROJECT/.env.example" ]; then
  cp "$PROJECT/.env.example" "$PROJECT/.env"
  echo "  ✓ Copied .env.example → .env"
  echo "  ⚠️  EDIT $PROJECT/.env to set RTSP_URL, AUTH_PASS, and VFD_ENABLED"
else
  echo "  ⚠️  No .env.example found — create $PROJECT/.env manually"
fi

# ── STEP 6: USB-to-RS485 udev rule (predictable name) ───────────
echo ""
echo "▶ STEP 6: Adding udev rule for USB-to-RS485 adapter (VFD)..."
sudo tee /etc/udev/rules.d/99-vfd-rs485.rules > /dev/null <<'EOF'
# FTDI / CH340 / Prolific USB-to-RS485 adapters → /dev/vfd-rs485
SUBSYSTEM=="tty", ATTRS{idVendor}=="0403", SYMLINK+="vfd-rs485"
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", SYMLINK+="vfd-rs485"
SUBSYSTEM=="tty", ATTRS{idVendor}=="067b", SYMLINK+="vfd-rs485"
EOF
sudo udevadm control --reload-rules
sudo usermod -a -G dialout pi   # grant serial-port access to user 'pi'
echo "  ✓ Adapter will appear as /dev/vfd-rs485 (and /dev/ttyUSB0)"

# ── STEP 7: Weights notice ──────────────────────────────────────
echo ""
echo "▶ STEP 7: YOLO model"
echo "  → Copy your trained model to:  $PROJECT/weights/best.pt"
echo "  → From your PC:  scp best.pt pi@<PI_IP>:$PROJECT/weights/"

# ── STEP 8: systemd service ─────────────────────────────────────
echo ""
echo "▶ STEP 8: Installing crusher.service ..."
sudo tee /etc/systemd/system/crusher.service > /dev/null <<EOF
[Unit]
Description=Kannan Crusher Monitor Backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=$PROJECT
EnvironmentFile=$PROJECT/.env
ExecStart=$VENV/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
# Service installed but NOT enabled for auto-start.
# Start manually with: sudo systemctl start crusher

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ SETUP COMPLETE"
echo ""
echo "  Next steps:"
echo "  1. Edit your environment:"
echo "     nano $PROJECT/.env"
echo "       - set RTSP_URL with real camera credentials"
echo "       - set AUTH_PASS to a strong password"
echo "       - set VFD_ENABLED=true once RS-485 is wired"
echo ""
echo "  2. Copy your trained model:"
echo "     scp best.pt pi@<PI_IP>:$PROJECT/weights/"
echo ""
echo "  3. Plug in the USB-to-RS485 adapter for the VFD"
echo "     Verify: ls -l /dev/vfd-rs485"
echo ""
echo "  4. Start the backend:"
echo "     sudo systemctl start crusher"
echo ""
echo "  5. Tail the logs:"
echo "     sudo journalctl -u crusher -f"
echo ""
echo "  6. Test the API:"
echo "     curl http://localhost:8000/api/status"
echo "     curl http://localhost:8000/api/vfd/status"
echo ""
echo "  7. Open the dashboard in a browser:"
echo "     http://<PI_IP>:8000/"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
