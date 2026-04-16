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

DEST="$(pwd)"

# 2. Check permissions
if [ "$EUID" -ne 0 ]; then
    echo "⚠️  Please run this script with sudo to install globally in /usr/local/bin."
    echo "Example: sudo bash install.sh"
    exit 1
fi

# 3. Setup
echo "=> Setting up Corely in $DEST..."

# Stop service if it's already running from a previous install
if systemctl is-active --quiet corely; then
    echo "=> Stopping existing Corely service..."
    systemctl stop corely
fi

echo "=> Installing dependencies..."
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

cat << EOF_CLI > /usr/local/bin/corely
#!/bin/bash
DIR="$DEST"
cd "\$DIR" || exit

case "\$1" in
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
    status)
        systemctl status corely
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
        rm -f "\$DIR/data/auth.json"
        rm -f "\$DIR/data/sessions.json"
        echo "Authentication reset. Navigate to the web UI to setup a new admin account."
        ;;
    uninstall)
        echo "Uninstalling Corely..."
        systemctl stop corely
        systemctl disable corely
        rm -f /etc/systemd/system/corely.service
        systemctl daemon-reload
        rm -f /usr/local/bin/corely
        echo "Corely system services have been removed."
        
        read -p "Do you also want to permanently delete the Corely application folder (and all your data) at \$DIR? [y/N]: " confirm
        if [[ "\$confirm" =~ ^[Yy]$ ]]; then
            rm -rf "\$DIR"
            echo "Directory deleted."
        else
            echo "Directory preserved. You can delete it manually later."
        fi
        echo "Uninstall complete."
        ;;
    *)
        echo "Corely CLI"
        echo "Usage: corely {start|stop|restart|status|enable|disable|reset|uninstall}"
        ;;
esac
EOF_CLI

chmod +x /usr/local/bin/corely

echo "==================================="
echo "✅ Corely installed successfully!"
echo "==================================="
echo "To start the manager, run: corely start"
echo "To reset the password later, run: corely reset"
echo "The web UI will be available on your network at port 1913."
