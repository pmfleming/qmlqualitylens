#!/usr/bin/env bash
set -euo pipefail

fixture_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
export QT_QPA_PLATFORM=offscreen
export QT_QUICK_BACKEND=software
exec "$fixture_root/build/bin/qmlqualitylens_smoke"
