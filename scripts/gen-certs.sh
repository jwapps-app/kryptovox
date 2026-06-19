#!/usr/bin/env bash
# Generate a locally-trusted TLS cert for the Vite dev server so Web Crypto +
# service workers work when testing from your phone over the Mac's LAN IP.
#
# Usage:  ./scripts/gen-certs.sh
set -euo pipefail

CERT_DIR="$(cd "$(dirname "$0")/.." && pwd)/frontend/certs"
mkdir -p "$CERT_DIR"

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert not found. Install it first:"
  echo "  brew install mkcert nss"
  exit 1
fi

# Install the local CA into the system + browser trust stores (idempotent).
mkcert -install

# Detect the Mac's primary LAN IP so the cert covers phone access.
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"

echo "Generating cert for: localhost 127.0.0.1 ${LAN_IP:-(no LAN IP detected)}"
mkcert \
  -cert-file "$CERT_DIR/cert.pem" \
  -key-file "$CERT_DIR/key.pem" \
  localhost 127.0.0.1 ${LAN_IP:-}

echo
echo "Certs written to frontend/certs/."
echo "Restart the stack (docker compose up) and open:"
echo "  https://localhost:5173            (this Mac)"
[ -n "${LAN_IP:-}" ] && echo "  https://$LAN_IP:5173   (your phone, same Wi-Fi)"
echo
echo "On the phone you must also trust the mkcert CA once — see README."
