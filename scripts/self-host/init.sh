#!/bin/sh
# Renamed to setup.sh (LUM-1332); kept so the LUM-1325 instructions still work.
exec sh "$(dirname "$0")/setup.sh" "$@"
