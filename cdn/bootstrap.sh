#!/bin/bash
# <UDF name="hostname" label="Hostname" />
# <UDF name="gcp_account" label="GCP Service Account JSON (base64)" />

set -euo pipefail

echo "Starting bootstrap for moq-relay on Debian..."

# Set hostname
hostnamectl set-hostname "$HOSTNAME"

# Install base packages
echo "Installing base packages..."
apt-get update
apt-get install -y rsync curl

# Create directories
mkdir -p /var/lib/moq
chmod 755 /var/lib/moq

# Write GCP credentials
echo "$GCP_ACCOUNT" | base64 -d > /var/lib/moq/gcp.json
chmod 600 /var/lib/moq/gcp.json

# Install Nix (multi-user installation)
echo "Installing Nix package manager..."
sh <(curl -L https://nixos.org/nix/install) --daemon --yes

# Enable flakes and configure Cachix
mkdir -p /etc/nix
cat > /etc/nix/nix.conf <<EOF
experimental-features = nix-command flakes
auto-optimise-store = true
extra-substituters = https://kixelated.cachix.org
extra-trusted-public-keys = kixelated.cachix.org-1:CmFcV0lyM6KuVM2m9mih0q4SrAa0XyCsiM7GHrz3KKk=
EOF

echo "Bootstrap complete. Deploy via 'just deploy <node>' to install services and credentials."
