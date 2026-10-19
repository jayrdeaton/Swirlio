#!/bin/zsh
# Reseeds one simulator's Swirlio install with a look from looks.json for the App Store screenshots,
# then relaunches it. The photosensitivity warning and the how-to-play guide are marked seen, sound is
# off, and the look's settings go over the defaults (fields left out keep their default).
#   store/seed/reseed.sh <simulator udid> <look> [extra settings json]
# Needs Jay's app-store-prep skill (asyncstorage.py). See store/README.md.
DIR=${0:A:h}
BUNDLE=com.infinitetoken.Swirlio
udid=$1
look=$2
extra=${3:-'{}'}
OUT=$(mktemp -d)/values.json
python3 - $DIR/looks.json $look "$extra" $OUT <<'EOF'
import json, sys
looks_path, look, extra, out = sys.argv[1:5]
looks = json.load(open(looks_path))
settings = {**looks['base'], **looks['looks'][look], **json.loads(extra)}
json.dump({
  'photosensitivity-warning-acknowledged': 'true',
  'guide-version-seen': '1',
  'swirlio.settings.v1': json.dumps(settings)
}, open(out, 'w'))
EOF
xcrun simctl terminate $udid $BUNDLE 2> /dev/null
python3 ~/.claude/skills/app-store-prep/scripts/asyncstorage.py $udid $BUNDLE $OUT
xcrun simctl launch $udid $BUNDLE
