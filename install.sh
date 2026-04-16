#!/bin/bash

# Corely Installer Script (Linux)
# https://github.com/FARIXZ/corely

echo "==================================="
echo "  Deploying Corely Action Manager  "
echo "==================================="

# 1. Dependency check
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js (v18+) and try again."
    exit 1
fi

DEST="/opt/corely"

# 2. Check permissions
if [ "$EUID" -ne 0 ]; then
    echo "⚠️  Please run this script with sudo to install globally in /opt and /usr/local/bin."
    echo "Example: sudo bash install.sh"
    exit 1
fi

# 3. Setup
echo "=> Installing Corely to $DEST..."
rm -rf "$DEST"
mkdir -p "$DEST"

# Copy all files from the current directory to DEST
cp -r . "$DEST/"

echo "=> Installing dependencies..."
cd "$DEST" || exit
npm install

# 4. Create the global CLI tool
echo "=> Installing CLI wrapper..."

cat << 'EOF' > /usr/local/bin/corely
#!/bin/bash
DIR="/opt/corely"
cd "$DIR" || exit

case "$1" in
    start)
        echo "Starting Corely on port 1913..."
        nohup node server.js > /dev/null 2>&1 &
        echo "Corely started in the background. Navigate to http://SERVER_IP:1913"
        ;;
    stop)
        echo "Stopping Corely..."
        pkill -f "node server.js"
        echo "Corely stopped."
        ;;
    reset)
        echo "Resetting Corely Authentication..."
        rm -f "$DIR/data/auth.json"
        rm -f "$DIR/data/sessions.json"
        echo "Authentication reset. Navigate to the web UI to setup a new admin account."
        ;;
    uninstall)
        echo "Uninstalling Corely..."
        pkill -f "node server.js"
        rm -rf "$DIR"
        rm -f /usr/local/bin/corely
        echo "Corely has been removed from your system."
        ;;
    *)
        echo "Corely CLI"
        echo "Usage: corely {start|stop|reset|uninstall}"
        ;;
esac
EOF

chmod +x /usr/local/bin/corely

echo "==================================="
echo "✅ Corely installed successfully!"
echo "==================================="
echo "To start the manager, run: corely start"
echo "To reset the password later, run: corely reset"
echo "The web UI will be available on your network at port 1913."
