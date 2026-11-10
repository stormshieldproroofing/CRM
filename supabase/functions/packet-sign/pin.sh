#!/bin/sh
# Pin packet-sign to the signing code + PDF templates committed at <commit>, then redeploy the function.
# Usage: supabase/functions/packet-sign/pin.sh <commit-sha>
set -e
REF="$1"; [ -n "$REF" ] || { echo "usage: $0 <commit-sha>"; exit 1; }
cd "$(git rev-parse --show-toplevel)"
JS=$(git show "$REF:crm-packet.js" | sha256sum | cut -d' ' -f1)
PDF=$(git show "$REF:StormShield_Claim_Packet.pdf" | sha256sum | cut -d' ' -f1)
CJS=$(git show "$REF:crm-contract.js" | sha256sum | cut -d' ' -f1)
CPDF=$(git show "$REF:StormShield_Contract.pdf" | sha256sum | cut -d' ' -f1)
F=supabase/functions/packet-sign/index.ts
sed -i -E "s/^const ASSETS_REF = \".*\";/const ASSETS_REF = \"$REF\";/; s/^const PACKET_JS_SHA256 = \".*\";/const PACKET_JS_SHA256 = \"$JS\";/; s/^const TEMPLATE_SHA256 = \".*\";/const TEMPLATE_SHA256 = \"$PDF\";/; s/^const CONTRACT_JS_SHA256 = \".*\";/const CONTRACT_JS_SHA256 = \"$CJS\";/; s/^const CONTRACT_PDF_SHA256 = \".*\";/const CONTRACT_PDF_SHA256 = \"$CPDF\";/" "$F"
echo "pinned $REF  packet js=$JS pdf=$PDF  contract js=$CJS pdf=$CPDF"
