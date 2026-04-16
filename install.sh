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

# Stop service if it's already running from a previous install
if systemctl is-active --quiet corely; then
    echo "=> Stopping existing Corely service..."
    systemctl stop corely
fi

# Backup existing data to prevent wipe on update
if [ -d "$DEST/data" ]; then
    echo "=> Preserving existing data and settings..."
    cp -r "$DEST/data" /tmp/corely_data_backup
fi

rm -rf "$DEST"
mkdir -p "$DEST"

# Copy all files from the current directory to DEST
cp -r . "$DEST/"

# Restore backed-up data
if [ -d "/tmp/corely_data_backup" ]; then
    rm -rf "$DEST/data"
    mv /tmp/corely_data_backup "$DEST/data"
fi

echo "=> Installing dependencies..."
cd "$DEST" || exit
npm install

# 4. Create the systemd service
echo "=> Configuring systemd service for auto-start..."
cat << EOF > /etc/systemd/system/corely.service
[Unit]
Description=Corely Action Manager Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$DEST
ExecStart=$(command -v node) server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable corely
systemctl start corely

# 5. Create the global CLI tool
echo "=> Installing CLI wrapper..."

cat << 'EOF' > /usr/local/bin/corely
#!/bin/bash
DIR="/opt/corely"
cd "$DIR" || exit

case "$1" in
    start)
        echo "Starting Corely via systemd..."
        systemctl start corely
        echo "Corely started. Navigate to http://SERVER_IP:1913"
        ;;
    stop)
        echo "Stopping Corely..."
        systemctl stop corely
        echo "Corely stopped."
        ;;
    restart)
        echo "Restarting Corely..."
        systemctl restart corely
        ;;
    enable)
        echo "Enabling Corely auto-start..."
        systemctl enable corely
        echo "Corely will now start automatically on server reboot."
        ;;
    disable)
        echo "Disabling Corely auto-start..."
        systemctl disable corely
        echo "Corely will no longer start automatically on server reboot."
        ;;
    reset)
        echo "Resetting Corely Authentication..."
        rm -f "$DIR/data/auth.json"
        rm -f "$DIR/data/sessions.json"
        echo "Authentication reset. Navigate to the web UI to setup a new admin account."
        ;;
    uninstall)
        echo "Uninstalling Corely..."
        systemctl stop corely
        systemctl disable corely
        rm -f /etc/systemd/system/corely.service
        systemctl daemon-reload
        rm -rf "$DIR"
        rm -f /usr/local/bin/corely
        echo "Corely has been removed from your system."
        ;;
    *)
        echo "Corely CLI"
        echo "Usage: corely {start|stop|restart|enable|disable|reset|uninstall}"
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
