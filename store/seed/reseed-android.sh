#!/bin/zsh
# The Android emulator's twin of reseed.sh: reseeds Swirlio's install with a look from looks.json for the
# Google Play screenshots, then relaunches it. The photosensitivity warning and the how-to-play guide are
# marked seen, sound is off, and the look's settings go over the defaults (fields left out keep their default).
#   store/seed/reseed-android.sh <look> [extra settings json]
# AsyncStorage on Android is the SQLite database databases/RKStorage (table catalystLocalStorage), reachable
# only through `adb shell run-as`, so the APK must be debuggable (a release build with `debuggable true` in
# android/app/build.gradle's release block) and must have launched once. See store/google-play.md.
DIR=${0:A:h}
PACKAGE=com.infinitetoken.swirlio
look=$1
extra=${2:-'{}'}
adb shell am force-stop $PACKAGE
python3 - $DIR/looks.json $look "$extra" $PACKAGE <<'EOF'
import hashlib, json, sqlite3, subprocess, sys, tempfile, os
looks_path, look, extra, package = sys.argv[1:5]
looks = json.load(open(looks_path))
settings = {**looks['base'], **looks['looks'][look], **json.loads(extra)}
entries = {
  'photosensitivity-warning-acknowledged': 'true',
  'guide-version-seen': '1',
  'swirlio.settings.v1': json.dumps(settings),
}
run_as = ['adb', 'shell', 'run-as', package]
with tempfile.TemporaryDirectory() as tmp:
  db_path = os.path.join(tmp, 'RKStorage')
  with open(db_path, 'wb') as f:
    f.write(subprocess.check_output(run_as + ['cat', 'databases/RKStorage']))
  db = sqlite3.connect(db_path)
  db.execute('PRAGMA journal_mode=DELETE')
  db.execute('DELETE FROM catalystLocalStorage')
  db.executemany('INSERT INTO catalystLocalStorage (key, value) VALUES (?, ?)', entries.items())
  db.commit()
  db.close()
  # Stale journal files would replay over the new database on the next open.
  subprocess.call(run_as + ['rm', '-f', 'databases/RKStorage-journal', 'databases/RKStorage-wal', 'databases/RKStorage-shm'])
  with open(db_path, 'rb') as f:
    # One string, so the redirect happens inside run-as's shell (adb shell joins its arguments with spaces).
    subprocess.run(['adb', 'shell', f"run-as {package} sh -c 'cat > databases/RKStorage'"], stdin=f, check=True)
  local = hashlib.md5(open(db_path, 'rb').read()).hexdigest()
  remote = hashlib.md5(subprocess.check_output(run_as + ['cat', 'databases/RKStorage'])).hexdigest()
  if local != remote:
    sys.exit('the database on the emulator does not match the one written')
EOF
adb shell am start -n $PACKAGE/.MainActivity > /dev/null
