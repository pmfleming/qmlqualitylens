#!/usr/bin/env bash
set -euo pipefail

fixture_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
export QT_QPA_PLATFORM=offscreen
exec qmltestrunner \
  -input "$fixture_root/tests" \
  -import "$fixture_root/build" \
  -o -,txt
