import { DashStyle } from '@/constants/strokeDash'
import type { SwirlSettings } from '@/hooks/useSwirlSettings'

// Every slider/toggle's own MIN/MAX range, its DEFAULT_* value where one is exported on its own (see
// each field's own comment for why), and the assembled defaultSettings object — split out of
// useSwirlSettings.tsx so that file can stay focused on the Context/Provider/hook plumbing itself. The
// only import from useSwirlSettings.tsx is the SwirlSettings type below, erased entirely at compile
// time (it's never referenced as a value here), so this doesn't actually create the runtime
// hook-dependency the "constants/*.ts stays a leaf" convention elsewhere in this codebase (see
// gravityWellMath.ts's own comment) is there to avoid.

// Bipolar, unlike the other speed-ish settings on this screen: negative is reverse, 0 is stopped,
// positive is forward. There's no separate boolean for direction anymore — it lives entirely in the
// sign of these two values, so rotation, zoom, and each colour list's own cycle speed can all run
// their own direction independently.
export const MIN_ZOOM_SPEED = -10
export const MAX_ZOOM_SPEED = 10
export const MAX_CYCLE_SPEED = 5
export const MIN_CYCLE_SPEED = -MAX_CYCLE_SPEED
export const MIN_STROKE_WIDTH = 1
export const MAX_STROKE_WIDTH = 36
export const MIN_TIGHTNESS = 0.4
export const MAX_TIGHTNESS = 2.5
export const MIN_ROTATION_SPEED = -10
export const MAX_ROTATION_SPEED = 10
export const MIN_MIRROR_ROTATION_SPEED = -10
export const MAX_MIRROR_ROTATION_SPEED = 10
// A fraction of each wedge's own angle (see kaleidoscope.ts's wedgeClipPath), not a fixed degree
// amount — 0 is no gap at all, the original edge-to-edge kaleidoscope. Stops short of 1 rather than
// reaching it: at gapFraction 1 the inset from each of a wedge's two edges would meet exactly in the
// middle and collapse it to nothing, so this leaves every wedge a visible sliver even at the slider's
// far end.
export const MIN_MIRROR_GAP = 0
export const MAX_MIRROR_GAP = 0.9
export const MIN_POLYGON_SIDES = 3
export const MAX_POLYGON_SIDES = 8
// The distance from the center (as a fraction of the full visible radius) at which the pattern is
// hard-clipped away — 1 reaches the true corner. Floored just above 0 rather than allowing it, since
// a cropRadius of exactly 0 has nothing left to show at all — not a useful "small" setting, just a
// blank canvas. There's no separate boolean for turning the crop off; that's cropRadius = 1.
export const MIN_CROP_RADIUS = 0.05
export const MAX_CROP_RADIUS = 1
// A fraction of cropRadius, not of the pattern's own radius — see the field's own comment above for
// why that keeps the hole from ever needing to be clamped against the crop separately. 0 and 1 are
// both meaningful ends (no hole; the whole crop circle hollowed out), so unlike MIN_CROP_RADIUS there's
// no need to floor this above 0.
export const MIN_HOLE_RADIUS = 0
export const MAX_HOLE_RADIUS = 1
// A per-second exponential decay rate applied to the epicentre's bounce velocity (see useEpicenter's
// frame callback) — velocity(t) = velocity0 * e^(-friction * t), not a plain 0-1 "amount". 0 is a
// perfectly elastic, never-settling bounce (left in as a deliberate toy extreme, not a bug); 5 kills
// nearly all velocity within a second, reading as barely a bounce at all before it comes to rest.
export const MIN_BOUNCE_FRICTION = 0
export const MAX_BOUNCE_FRICTION = 5
export const DEFAULT_BOUNCE_FRICTION = 1
// A rate dial, the same shape as bounceFriction just above — not a raw duration — so that "lower
// value, longer visible" holds smoothly all the way down to 0, rather than a plain seconds-of-delay
// field where 0 ("off") would have to sit right next to the shortest numeric delay and jump straight
// to the longest as the slider moves away from it. 0 is a deliberate toy extreme (never auto-hides at
// all, left visible until an explicit gesture dismisses it — see index.tsx's own hideControls call
// sites), not a bug; 5 hides as quickly as this control ever will. See controlsAutoHideDelayMs below
// for how this converts to an actual setTimeout duration.
export const MIN_CONTROLS_AUTO_HIDE_SPEED = 0
export const MAX_CONTROLS_AUTO_HIDE_SPEED = 5
export const DEFAULT_CONTROLS_AUTO_HIDE_SPEED = 1
// The delay, in ms, at controlsAutoHideSpeed's own default (1) — chosen so that default reproduces
// exactly this app's original fixed 5-second idle-fade behavior, unchanged, rather than picking some
// other "round" base and quietly shifting what a fresh install (or an existing save with no persisted
// controlsAutoHideSpeed) actually does.
export const CONTROLS_AUTO_HIDE_BASE_MS = 5000
// Shared by index.tsx (the actual idle-fade setTimeout) and the settings slider's own seconds readout,
// so both agree on exactly the same number rather than each reimplementing this division. null means
// "off" — the speed-0 extreme, where there's no delay to compute at all because the idle-fade timer
// never fires in the first place (see index.tsx's own effect).
export function controlsAutoHideDelayMs(speed: number): number | null {
  return speed > 0 ? CONTROLS_AUTO_HIDE_BASE_MS / speed : null
}
// A spring constant (acceleration = -gravity * (position - gravityCenter), both in fraction-of-window
// units) applied every frame gravity is nonzero, not just alongside a release-driven bounce — see
// useDragPointPhysics.ts's frame callback and its ambient-activation reaction. 0 leaves the epicentre
// with no pull toward the gravity center at all; 5 pulls it back firmly enough to noticeably overshoot
// past the gravity center before friction and further pulls settle it there. Nonzero by default (see
// DEFAULT_GRAVITY) so tilt has something to actually roll the epicentre with out of the box.
// MIN is -MAX_GRAVITY, not 0 — negative gravity is a repeller (the same spring constant, flipped into
// pushing the epicentre away instead of pulling it in). This used to be pinned at 0 (repel tried and
// pulled back out, not because anything about it was broken, just not worth keeping live at the time)
// but the physics (useDragPointPhysics.ts's own gravity!==0 checks, not gravity>0) and the gravity
// marker's magnitude-based sizing (Spiral.tsx's gravityWellHoleRadius) were always written to handle
// a negative value correctly, so re-enabling it here was just reopening the range — see gravity mode's
// own "reverse push/pull" transport button (OnScreenControls.tsx) — a one-tap flip — the slider (see
// ControlGroupBottomSheetContent's snapToZero) can reach it too by dragging through, and so can the
// gravity-targeting pinch gesture itself (see index.tsx's own GRAVITY_ZERO_STICKY_ZONE).
export const MAX_GRAVITY = 5
export const MIN_GRAVITY = -MAX_GRAVITY
export const DEFAULT_GRAVITY = 1
// A linear multiplier on raw mic RMS, not a dB amount — see micSensitivity's own comment on
// SwirlSettings above. 1 is unity/neutral (exactly useAudioReactive's existing calibration, unchanged
// from before this setting existed), and 4 is loud enough to push even a quiet room's mic input toward
// the top of rmsToUnit's own dB window. MIN deliberately stops short of 0 — audioReactiveEnabled (the
// mic FAB) is already the on/off switch, so this only needs to cover "how sensitive," and a true 0
// would multiply every reading to exactly 0 no matter how loud the room actually got, reading as a
// second, redundant off switch (and a broken one at that, since nothing could ever push through it)
// rather than an extreme end of "quiet."
export const MIN_MIC_SENSITIVITY = 0.1
export const MAX_MIC_SENSITIVITY = 4
// A time-scale multiplier on the spring driving glideTo/recenter (see useDragPointPhysics.ts), not a
// raw damping/stiffness value — 1 is the original feel (BASE_DAMPING/BASE_STIFFNESS, unscaled), 3 is
// noticeably snappier, and 0.25 is slow and floaty enough to watch the catch-up happen frame by frame.
// Scaling stiffness by speed^2 and damping by speed (rather than moving either alone) is what keeps
// the spring's own damping *ratio* — how bouncy versus dead-stop it looks — constant across the whole
// range: only how fast it gets there changes, not its character. MIN stops short of 0 — a speed of
// exactly 0 would leave the spring with zero stiffness at all, meaning glideTo would never move
// anything, which isn't a useful "slow" extreme, just broken.
export const MIN_FOLLOW_SPEED = 0.25
export const MAX_FOLLOW_SPEED = 3

export const DEFAULT_BACKGROUND_COLORS = ['#000000']
export const DEFAULT_FOREGROUND_COLORS = ['#FFFFFF']
// Line's own four fields (dashStyle/fixedSpacing/strokeWidth/tightness) — exported the same way the
// two color lists above are, so the Line group's own Reset button (see ControlGroupTopSheetContent)
// can set each one back to exactly this value from outside this file, instead of either duplicating
// the literal here (drifting silently if this default ever changes) or going through resetSettings'
// flat whole-settings replacement, which resets every *other* group's fields too.
export const DEFAULT_DASH_STYLE: DashStyle = 'solid'
export const DEFAULT_FIXED_SPACING = false
// Dead center of each one's own slider (MIN_STROKE_WIDTH/MAX_STROKE_WIDTH, MIN_TIGHTNESS/
// MAX_TIGHTNESS above) rather than some other "looks reasonable" point off to one side — a centered
// thumb reads as "here's the middle of the range" on sight, and leaves equal room to explore in
// either direction from a first launch or a Reset, instead of nudging toward whichever end the old
// off-center default happened to sit closer to.
export const DEFAULT_STROKE_WIDTH = (MIN_STROKE_WIDTH + MAX_STROKE_WIDTH) / 2
export const DEFAULT_TIGHTNESS = (MIN_TIGHTNESS + MAX_TIGHTNESS) / 2
// Mirror's own four fields — exported the same way Line's own four above are, so the Mirror group's
// Reset button (see ControlGroupTopSheetContent) can set each one back to exactly this value from
// outside this file, rather than resetMirror's own gesture-state reset (rotation angle, anchor
// position) trying to also stand in for the persisted settings underneath it.
export const DEFAULT_MIRROR_ALTERNATE_COLORS = false
export const DEFAULT_MIRROR_GAP = 0
export const DEFAULT_MIRROR_LINES = 0
export const DEFAULT_MIRROR_ROTATION_SPEED = 0

export const defaultSettings: SwirlSettings = {
  audioReactiveEnabled: false,
  backgroundColors: DEFAULT_BACKGROUND_COLORS,
  backgroundCycleSpeed: 1,
  bounceFriction: DEFAULT_BOUNCE_FRICTION,
  controlsAutoHideSpeed: DEFAULT_CONTROLS_AUTO_HIDE_SPEED,
  cropRadius: 1,
  cropShaped: true,
  dashStyle: DEFAULT_DASH_STYLE,
  fixedSpacing: DEFAULT_FIXED_SPACING,
  followSpeed: 1,
  foregroundColors: DEFAULT_FOREGROUND_COLORS,
  foregroundCycleSpeed: 1,
  gestureTarget: 'pattern',
  gravity: DEFAULT_GRAVITY,
  gravityMarkerVisible: false,
  hapticsEnabled: true,
  holeRadius: 0,
  holeShaped: true,
  micSensitivity: 1,
  mirrorAlternateColors: DEFAULT_MIRROR_ALTERNATE_COLORS,
  mirrorGap: DEFAULT_MIRROR_GAP,
  mirrorLines: DEFAULT_MIRROR_LINES,
  mirrorRotationSpeed: DEFAULT_MIRROR_ROTATION_SPEED,
  pattern: 'spiral',
  polygonSides: 4,
  // 2, not the more obviously "normal-speed" 1 — matches zoomSpeed's own default below, and there's
  // no scale-derived reason to prefer either number now that both sliders drag freely (see FREE_STEP
  // in ControlGroupBottomSheetContent) rather than snapping to a step grid.
  rotationSpeed: 2,
  shakeEnabled: true,
  showLabels: false,
  soundEnabled: true,
  strokeWidth: DEFAULT_STROKE_WIDTH,
  tightness: DEFAULT_TIGHTNESS,
  tiltEnabled: true,
  triggerStackExpanded: true,
  zoomSpeed: 2
}
