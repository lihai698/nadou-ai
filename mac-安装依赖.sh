#!/bin/bash
cd "$(dirname "$0")"
echo "============================================"
echo "   Installing pinned dependencies"
echo "============================================"
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python not found. Please install Python 3.10+"
    echo "Download: https://www.python.org/downloads/"
    read -p "Press Enter to exit..."
    exit 1
fi

python3 --version

echo ""
echo "[1/2] Checking pip..."
python3 -m pip --version &> /dev/null
if [ $? -ne 0 ]; then
    echo "pip not found, bootstrapping..."
    if ! python3 -m ensurepip --upgrade; then
        echo "[ERROR] Could not install pip."
        exit 1
    fi
fi

echo "[2/2] Installing from package index..."
if ! python3 -m pip install -r requirements.lock; then
    echo "[ERROR] Dependency installation failed."
    exit 1
fi

echo ""
echo "Done. Run 'bash mac-启动服务.sh' to start."
if [ -t 0 ]; then
    read -r -p "Press Enter to exit..." _
fi
