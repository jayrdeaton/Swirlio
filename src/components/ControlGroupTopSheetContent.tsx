import { useThemeSettings } from '@rific/auto-paper'
import { useUpdater } from '@rific/updater'
import React from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { TOP_SHEET_HEADER_CLEARANCE, TOP_SHEET_RIGHT_CLEARANCE } from '@/constants/sheetLayout'
import { useControlGroups } from '@/hooks/controlGroups'
import { useSwirlRandomize } from '@/hooks/swirlRandomize'
import { useSwirlReset } from '@/hooks/swirlReset'
import { useSwapColors } from '@/hooks/useSwapColors'
import { DEFAULT_BACKGROUND_COLORS, DEFAULT_BOUNCE_FRICTION, DEFAULT_DASH_STYLE, DEFAULT_FIXED_SPACING, DEFAULT_FOREGROUND_COLORS, DEFAULT_GRAVITY, DEFAULT_MIRROR_ALTERNATE_COLORS, DEFAULT_MIRROR_GAP, DEFAULT_MIRROR_LINES, DEFAULT_MIRROR_ROTATION_SPEED, DEFAULT_STROKE_WIDTH, DEFAULT_TIGHTNESS, useSwirlSettings } from '@/hooks/useSwirlSettings'

import { ActionFab } from './ActionFab'
import { FAB_ROW_GAP, FabRow } from './FabRow'
import { SettingToggleFab } from './SettingToggleFab'
import { useAppearanceIconFabs } from './useAppearanceIconFabs'
import { useColorListFabs } from './useColorListFabs'
import { useDashStyleIconFabs } from './useDashStyleIconFabs'
import { usePatternIconFabs } from './usePatternIconFabs'

// Shake (Accelerometer), tilt (DeviceMotion), audio-reactive (mic capture), and haptics all no-op (or
// worse — see Audio reactive's own comment below) on web already — hiding their toggles here too
// rather than leaving them visible-but-inert avoids the "why doesn't this do anything" confusion of a
// control with nothing behind it to control.
const isWeb = Platform.OS === 'web'

// The buttons/pickers half of the group sheet — see ControlGroupBottomSheetContent for the sliders
// half. Split into two independently-anchored sheets (this one top, sliders bottom) that open and
// close together — see controlGroups.tsx — rather than one combined sheet, so the canvas stays
// visible through the middle of the screen while either is open instead of one big block covering
// most of it.
export function ControlGroupTopSheetContent() {
  const insets = useSafeAreaInsets()
  const { activeGroup } = useControlGroups()
  const { settings, resetSettings, setAudioReactiveEnabled, setBackgroundColors, setBounceFriction, setCropShaped, setDashStyle, setFixedSpacing, setForegroundColors, setGravity, setGravityMarkerVisible, setHapticsEnabled, setHoleShaped, setMirrorAlternateColors, setMirrorGap, setMirrorLines, setMirrorRotationSpeed, setPattern, setShakeEnabled, setShowLabels, setStrokeWidth, setTiltEnabled, setTightness } = useSwirlSettings()
  const { swapColors } = useSwapColors()
  const { resetGravity, resetMirror, resetPattern } = useSwirlReset()
  const { randomizeGroup } = useSwirlRandomize()
  // autoCheck: false — the sheet only checks on an explicit tap, no silent AppState-triggered fetch
  // (see @rific/updater's own README). onConfirm/onError are left at the package defaults, which
  // already show the exact "Update available" Alert (release date + optional message, Restart/Cancel)
  // this app wants — no need to duplicate that dialog locally.
  const { check: checkForUpdate, checking: checkingForUpdate } = useUpdater({ autoCheck: false })
  // App-wide look rather than a per-swirl setting, so it lives in @rific/auto-paper's own
  // ThemeSettingsContext instead of useSwirlSettings — see _layout.tsx's MonochromeThemeBridge for
  // how `appearance` feeds back into the forced black/white accent.
  const { settings: themeSettings, set: setThemeSettings } = useThemeSettings()

  // Renders whatever the sheet was last opened to even while it's animating closed, rather than
  // going blank — same reasoning as ControlGroupProvider not resetting activeGroup on close.
  const group = activeGroup ?? 'mirror'

  // Hooks, not JSX components — a component would render as one opaque child instead of several
  // individually spreadable ones, and the branches below need every FAB as a real flat sibling to
  // place into whichever FabRow (see usePreviewOptionFabs for the same reasoning). Called
  // unconditionally regardless of which group is active, same as any other hook.
  const patternFabs = usePatternIconFabs(settings.pattern, setPattern)
  const dashStyleFabs = useDashStyleIconFabs(settings.dashStyle, setDashStyle)
  const foregroundColorFabs = useColorListFabs('Foreground', settings.foregroundColors, setForegroundColors)
  const backgroundColorFabs = useColorListFabs('Background', settings.backgroundColors, setBackgroundColors)
  const appearanceFabs = useAppearanceIconFabs(themeSettings.appearance, (value) => setThemeSettings({ appearance: value }))

  return (
    <View style={{ paddingTop: insets.top + TOP_SHEET_HEADER_CLEARANCE, paddingRight: TOP_SHEET_RIGHT_CLEARANCE }}>
      <View style={styles.body}>
        {group === 'mirror' && (
          <>
            <FabRow>
              {/* Leads every group's row now (Colors/Pattern/Line below follow the same lead-with-
              Randomize-then-Reset order) rather than trailing after that group's own toggles/pickers:
              styles.body's fixed left padding puts this same first slot at the same screen position
              regardless of which group is open, and TOP_SHEET_HEADER_CLEARANCE (sheetLayout.ts)
              already lands that first row at the closed-sheet dice FAB's own y — so rerolling
              whichever group you're in is one tap at a spot your thumb already knows, not a different
              position per group. Rerolls mirror lines/gap/alternate-colors — same rerollUnitsByGroup
              slice the global dice FAB and shake gesture already pull 'mirror' units from (see
              index.tsx's randomizeGroup), just scoped to this group instead of every field at once.
              Same icon as the global dice FAB (OnScreenControls) for a consistent "this randomizes"
              affordance. */}
              <ActionFab icon='dice-multiple' label='Randomize' onPress={() => randomizeGroup('mirror')} />
              {/* Right after Randomize, not off with the toggle below — both read as one-tap,
              whole-group actions, distinct from Alternate colors' own single-field toggle. Puts
              every persisted mirror field (lines/rotation speed/gap/alternate colors) back to its
              default, the same "every field this group owns" shape as Line's own Reset below,
              alongside resetMirror's gesture-state half (squares the wedges' rotation back to 0 AND
              snaps the mirror anchor back to center — see index.tsx's resetMirror). Used to be
              gesture-state-only, paired with a tap on the anchor itself to recentre it, but that tap
              had no fixed visual marker to aim at once the pattern was mirrored (there's nothing to
              see there, just wherever you last dragged it to) — this button is now the only,
              findable way to reach any of it. Short, icon-disambiguated label (not "Reset mirror")
              matching the Colors group's own Reset/Swap pair below and Pattern's own reset button
              (see the 'pattern' branch below) — all three just say "Reset", disambiguated only by
              whichever sheet happens to be open. */}
              <ActionFab
                icon='backup-restore'
                label='Reset'
                onPress={() => {
                  setMirrorLines(DEFAULT_MIRROR_LINES)
                  setMirrorRotationSpeed(DEFAULT_MIRROR_ROTATION_SPEED)
                  setMirrorGap(DEFAULT_MIRROR_GAP)
                  setMirrorAlternateColors(DEFAULT_MIRROR_ALTERNATE_COLORS)
                  resetMirror()
                }}
              />
              {/* Shares this row with Randomize/Reset rather than getting a break of its own (compare
              Pattern/Line below, which do break their own trailing toggle out): with only 3 FABs
              total in this group, a forced break just left two sparse rows — 2 icons up top, 1 alone
              below, both with room to spare — instead of one that actually fills the width. Left
              enabled even at 0 mirror lines (where it has nothing to act on yet) rather than disabled
              until the Mirror lines slider (see the bottom sheet) is raised — toggling it ahead of
              time just pre-arms the setting for whenever mirror lines does go above 0. */}
              <SettingToggleFab icon='checkerboard' label='Alternate colors' value={settings.mirrorAlternateColors} onValueChange={setMirrorAlternateColors} />
            </FabRow>
          </>
        )}

        {group === 'colors' && (
          <>
            <FabRow>
              {/* Leads the row — see Mirror's own comment above for why Randomize/Reset front every
              group now. Swap joins them here rather than down with the swatches below: it's the same
              one-tap, whole-group action as the other two, just colors-specific. Rerolls the fg/bg
              color pair — the same single 'colors' rerollUnitsByGroup unit the global dice FAB and
              shake gesture already reroll (see index.tsx's randomizeGroup). Same icon as the global
              dice FAB (OnScreenControls) for a consistent "this randomizes" affordance. */}
              <ActionFab icon='dice-multiple' label='Randomize' onPress={() => randomizeGroup('colors')} />
              <ActionFab
                icon='backup-restore'
                // Short, single-word labels here (not "Reset colors"/"Swap colors") — the icon alone
                // already disambiguates from "Reset rotation" elsewhere.
                label='Reset'
                onPress={() => {
                  setForegroundColors(DEFAULT_FOREGROUND_COLORS)
                  setBackgroundColors(DEFAULT_BACKGROUND_COLORS)
                }}
              />
              <ActionFab icon='swap-horizontal' label='Swap' onPress={swapColors} />
            </FabRow>
            {/* Each color list gets its own row rather than trailing the actions above or each other
            on whatever line they happen to wrap to — see Mirror's own comment for why a row break,
            not a plain gap, is what actually marks a cluster boundary consistently regardless of
            width. Foreground and background are two peer clusters, not one, so each gets its own
            break rather than sharing a row between them too. The first swatch in each still wears the
            list's own name ("Foreground"/"Background") as its caption (see useColorListFabs) instead
            of a separate non-interactive label FAB taking up a slot of its own. */}
            <FabRow>{foregroundColorFabs.fabs}</FabRow>
            <FabRow>{backgroundColorFabs.fabs}</FabRow>
            {foregroundColorFabs.dialog}
            {backgroundColorFabs.dialog}
          </>
        )}

        {group === 'pattern' && (
          <>
            <FabRow>
              {/* Leads the row — see Mirror's own comment above for why Randomize/Reset front every
              group now. Rerolls pattern+sides, crop radius/shaped, and hole radius/shaped — the
              'pattern' rerollUnitsByGroup slice the global dice FAB and shake gesture already pull
              from (see index.tsx's randomizeGroup). Same icon as the global dice FAB
              (OnScreenControls) for a consistent "this randomizes" affordance. */}
              <ActionFab icon='dice-multiple' label='Randomize' onPress={() => randomizeGroup('pattern')} />
              {/* Squares the pattern's rotation back to 0 AND snaps the epicentre back to center —
              see index.tsx's resetPattern. No effect on zoom, which has no orientation of its own to
              reset. Used to be rotation-only, paired with a tap on the epicentre itself to recentre
              it, but that tap had no fixed visual marker to aim at once the pattern was mirrored —
              this button is now the only, findable way to reach either half. Short,
              icon-disambiguated label matching Mirror's own reset button (see the 'mirror' branch
              above) and the Colors group's Reset/Swap pair above — all three just say "Reset",
              disambiguated only by whichever sheet happens to be open. */}
              <ActionFab icon='backup-restore' label='Reset' onPress={resetPattern} />
              {/* Crop/Hole share this row with Randomize/Reset rather than getting a break of their
              own — see Mirror's own comment on Alternate colors for why: on their own they're just 2
              more icons in an otherwise-sparse row, not a cluster substantial enough to earn a whole
              line the way the type picker below does. Live here rather than in Line: now that either
              can trace the active pattern's own outline (see Spiral.tsx's shapedClipPoints), they're
              as much a "what shape is this" decision as Sides/Points/Petals is, not just a
              stroke-rendering knob. Left enabled for every pattern, including Spiral/Starburst/Rings
              — those have no closed boundary of their own and always clip to a plain circle
              regardless — but pre-arming the toggle here means it's already set the way the user
              wants the moment they switch to Polygon/Star/Flower, same "toggleable ahead of having
              anything to act on" reasoning as Alternate colors gets in Mirror. Distinct icons even
              though the two toggles are otherwise identical in shape (a plain outline for the outer
              Crop, a bounded/contained outline for the inner Hole) — matching this app's own
              one-icon-per-control convention rather than reusing Sides' own vector-polygon glyph,
              which reads as "how many points", not "trace the shape". */}
              <SettingToggleFab icon='shape-outline' label='Crop shape' value={settings.cropShaped} onValueChange={setCropShaped} />
              <SettingToggleFab icon='contain' label='Hole shape' value={settings.holeShaped} onValueChange={setHoleShaped} />
            </FabRow>
            {/* The type picker gets its own row rather than trailing the actions/toggles above on
            whatever line it happens to wrap to — see Mirror's own comment for why a row break, not a
            plain gap, is what actually marks a cluster boundary consistently regardless of width. 6
            options is enough to fill (and usually wrap) a line on its own, unlike the sparse row
            above it. */}
            <FabRow>{patternFabs}</FabRow>
          </>
        )}

        {group === 'line' && (
          <>
            <FabRow>
              {/* Leads the row — see Mirror's own comment above for why Randomize fronts every group
              now. Rerolls dash style, tightness, and stroke width — the 'line' rerollUnitsByGroup
              slice the global dice FAB and shake gesture already pull from (see index.tsx's
              randomizeGroup). Same icon as the global dice FAB (OnScreenControls) for a consistent
              "this randomizes" affordance. */}
              <ActionFab icon='dice-multiple' label='Randomize' onPress={() => randomizeGroup('line')} />
              {/* Unlike Mirror/Pattern's own Reset (see their own comments), there's no rotation or
              position for Line to square back up — dash style/fixed spacing/stroke width/tightness
              are plain persisted preferences, not gesture-driven SharedValues bridged through
              useSwirlReset (see swirlReset.tsx's own comment for why that hook is scoped to exactly
              that ephemeral state and nothing else). So this resets values instead, the same way
              Colors' own Reset does for its two color lists — every field this group owns, back to
              its default, in one tap, without touching any other group's own settings the way
              resetSettings' flat whole-app reset would. */}
              <ActionFab
                icon='backup-restore'
                label='Reset'
                onPress={() => {
                  setDashStyle(DEFAULT_DASH_STYLE)
                  setFixedSpacing(DEFAULT_FIXED_SPACING)
                  setStrokeWidth(DEFAULT_STROKE_WIDTH)
                  setTightness(DEFAULT_TIGHTNESS)
                }}
              />
              {/* Shares this row with Randomize/Reset rather than getting a break of its own — see
              Mirror's own comment on Alternate colors for why: alone it's just 1 more icon in an
              otherwise-sparse row, not worth a whole line the way the dash style picker below is.
              Lives here rather than in Pattern: it's paired with Tightness (see the bottom sheet), and
              together they're about how densely the rendered strokes are packed, not which dash style
              is showing — Crop/Hole shape moved the other way for the same reasoning (see the
              'pattern' branch above). Off by default: dragging the epicentre toward an edge grows the
              pattern's own radius (so it still reaches the farthest corner — see Spiral.tsx), and
              every ring/turn/ray is spaced as a fraction of that radius, so they spread out right
              along with it. This pins that spacing to what it looks like at a centered epicentre
              instead. */}
              <SettingToggleFab icon='ruler' label='Fixed spacing' value={settings.fixedSpacing} onValueChange={setFixedSpacing} />
            </FabRow>
            {/* The dash style picker gets its own row rather than trailing the actions/toggle above on
            whatever line it happens to wrap to — see Mirror's own comment for why a row break, not a
            plain gap, is what actually marks a cluster boundary consistently regardless of width. 6
            options is enough to fill (and usually wrap) a line on its own, unlike the sparse row
            above it. */}
            <FabRow>{dashStyleFabs}</FabRow>
          </>
        )}

        {group === 'settings' && (
          <>
            <FabRow>
              {/* Leads the row — see Mirror's own comment above for why Randomize/Reset front every
              group now. Settings has no "look" of its own to reroll (its own sheet is toggles/
              appearance, not a slider-backed field — see useRerollUnits' own rerollUnitsByGroup), so
              this rerolls every OTHER look group's units at once instead — the exact same reroll the
              shake gesture triggers (see index.tsx's randomize/rerollUnits) — rather than being left out
              the way a genuinely look-less group otherwise would be. Deliberately excludes gravity's own
              Friction/Gravity strength sliders (see useRerollUnits' own top comment: randomizing should
              change the look, not the feel) — the 'gravity' group's own Randomize button below is the
              one place that still touches those. Also reachable without opening this sheet at all, via a
              long press on either the cog trigger or the always-visible chevron above it (see
              OnScreenControls) — the corner dice FAB used to be the one dedicated shortcut for this
              exact reroll; now that it's freed up for Pause/Play, those two long presses are what took
              its place. */}
              <ActionFab icon='dice-multiple' label='Randomize' onPress={() => randomizeGroup('settings')} />
              {/* The one button in this group that isn't its own preference — every slider and toggle
              across all five groups, plus the pattern/mirror rotation+position the per-group Reset
              buttons above already square back up (resetPattern/resetMirror), in one tap. 'Reset'
              alone (matching Mirror/Pattern/Colors' own buttons) would read as scoped to whichever
              sheet happens to be open, same as those three — 'Reset all' says plainly that this one
              isn't. themeSettings (appearance/blur/blurTint/harmony — a separate persisted store from
              useSwirlSettings, see @rific/auto-paper's ThemeProvider) is deliberately left untouched
              entirely, not just its `color` field: appearance and blur are look preferences the user
              set deliberately, same reasoning as the mic/shake/tilt/labels carve-outs in
              resetSettings' own comment, so a flat reset shouldn't silently switch them back either. */}
              <ActionFab
                icon='backup-restore'
                label='Reset all'
                onPress={() => {
                  resetSettings()
                  resetPattern()
                  resetMirror()
                }}
              />
              {/* Manual-only (autoCheck: false above) rather than a silent auto-notify — this is a toy
              app with no push infra, so "tap to check" is the whole update story, same one-tap-action
              shape as Randomize/Reset all beside it. Disabled while in flight instead of a spinner —
              no loading affordance exists on any FAB in this app (see LabeledFab), so this doesn't
              invent one just for this button. */}
              <ActionFab icon='download' label='Check for update' disabled={checkingForUpdate} onPress={checkForUpdate} />
              {/* Shares this row with Randomize/Reset rather than getting its own forced break — unlike
              Pattern's type picker or Line's dash style picker (each a wider, self-contained cluster
              worth its own line), appearance is just 3 more buttons, so it wraps in alongside
              Randomize/Reset the same ordinary way any FabRow wraps once it runs out of width, instead
              of always starting on a fresh line regardless of how much room is left on this one. */}
              {appearanceFabs}
            </FabRow>
            <FabRow>
              <SettingToggleFab icon='blur' label='Blur' value={themeSettings.blur} onValueChange={(value) => setThemeSettings({ blur: value })} />
              {/* Governs every FAB and SettingSlider on screen — see LabeledFab/SettingSlider — not
              just this sheet's own controls. */}
              <SettingToggleFab icon='label' label='Labels' value={settings.showLabels} onValueChange={setShowLabels} />
              {!isWeb && <SettingToggleFab icon='vibrate' label='Shake to randomize' value={settings.shakeEnabled} onValueChange={setShakeEnabled} />}
              {/* Moved here from a dedicated on-canvas transport-row FAB now that both of the
              transport row's contextual slots are mode-specific (see OnScreenControls' own slotA/slotB)
              — joins Mic sensitivity, which already lived in this same group's bottom sheet, so every
              mic-related control is reachable from one trigger. Same on/off toggle it always was, just
              relocated. Hidden on web: react-native-audio-api's web target has no microphone-capable
              node at all (see useAudioReactive.ts's own comment), so mic capture bails out silently
              there — worse, the toggle itself would still pin rotation/zoom/tightness/crop/hole/mirror
              gap/stroke width to their zero-audio-input values the moment it's on, since those
              `effective*` overrides in index.tsx only check audioReactiveEnabled, not platform. */}
              {!isWeb && <SettingToggleFab icon='microphone' label='Audio reactive' value={settings.audioReactiveEnabled} onValueChange={setAudioReactiveEnabled} />}
              {/* Governs the same shared HapticSettingsContext flag every haptic call site in the app
              already gates on — see _layout.tsx's HapticsSettingsBridge — so this one toggle covers
              both the manual useVibration() calls and every auto-haptic FAB/button with no per-call-site
              changes needed. Hidden on web for the same reason Shake/Tilt are: expo-haptics is
              native-only, and useVibration's own web fallback (RN Web's Vibration.vibrate, guarded
              behind `'vibrate' in navigator`) is unsupported on iOS Safari and inert on desktop with no
              vibration hardware — real haptics only, same bar every other toggle in this row is held
              to. `gesture-tap` rather than a second vibrate-family glyph: sitting right next to Shake's
              `vibrate` icon, a `vibrate`/`vibrate-off` pair read as near-duplicates at a glance despite
              meaning unrelated things (a physical shake gesture vs. press feedback on every tap). */}
              {!isWeb && <SettingToggleFab icon='gesture-tap' label='Haptics' value={settings.hapticsEnabled} onValueChange={setHapticsEnabled} />}
            </FabRow>
          </>
        )}

        {group === 'gravity' && (
          <FabRow>
            {/* Leads the row — see Mirror's own comment above for why Randomize/Reset front every
            group now. Rerolls Friction and Gravity strength — the 'gravity' rerollUnitsByGroup slice,
            which is now the ONLY reroll that reaches these two: the global dice FAB, shake gesture, and
            forward-tweak transport button all deliberately skip gravity's own units (see
            useRerollUnits' own top comment — randomizing should change the look, not the feel), so this
            button is what's left for actually randomizing physics on purpose. Same icon as the global
            dice FAB (OnScreenControls) for a consistent "this randomizes" affordance. Never touches the
            gravity handle's own position, same as every other group's Randomize leaving ephemeral state
            to its own Reset button instead. */}
            <ActionFab icon='dice-multiple' label='Randomize' onPress={() => randomizeGroup('gravity')} />
            {/* Puts both persisted fields this group owns (Friction, Gravity strength) back to
            default AND recentres the gravity handle itself back to the well's own center
            (resetGravity, bridged through useSwirlReset the same way resetMirror/resetPattern are —
            see index.tsx's own resetGravityPosition) — the same "persisted half here, ephemeral half
            via the bridge" split Mirror/Pattern's own Reset buttons use. Short, icon-disambiguated
            label matching every other group's own Reset button (see Mirror's own comment). */}
            <ActionFab
              icon='backup-restore'
              label='Reset'
              onPress={() => {
                setBounceFriction(DEFAULT_BOUNCE_FRICTION)
                setGravity(DEFAULT_GRAVITY)
                resetGravity()
              }}
            />
            {/* Whether GravityWell (Spiral.tsx) shows at all — independent of gestureTarget, so this
            is reachable (and stays in sync) regardless of which mode is active, unlike most of this
            row's neighbors — same shared gravityMarkerVisible setting the on-canvas transport-row
            toggle reads and writes too (see OnScreenControls' own gravity-branch comment); either one
            moves the other. On shows the well on every gesture mode; off hides it even while actively
            dragging gravity. See useSwirlSettings.tsx's own gravityMarkerVisible comment for why this
            is a persisted chrome preference rather than an ephemeral, per-group setting like the two
            buttons above it. */}
            <SettingToggleFab icon='eye' label='Visible' value={settings.gravityMarkerVisible} onValueChange={setGravityMarkerVisible} />
            {/* Tilt (DeviceMotion) no-ops on web already (see useTiltGravityCenter.ts's own
            Platform.OS check) — hidden here for the same reason every other web-inert toggle is (see
            isWeb's own comment). Drives whichever gesture target is currently active (pattern/mirror/
            gravity/speed — see useEpicenter.ts and index.tsx's own tilt wiring), not just gravity, so
            it's still a global input-mode preference rather than something this group alone owns —
            it just lives here now as the same kind of physics-feel tuning as Friction/Gravity/Follow
            speed above, rather than filed under Settings alongside Labels/Haptics/Shake. Left out of
            this group's own Randomize above for the same reason Shake/Mic are (see resetSettings' own
            comment and useRerollUnits.tsx): a behavioral device-capability toggle the user sets
            deliberately, not a look to reroll. */}
            {!isWeb && <SettingToggleFab icon='axis-arrow' label='Tilt control' value={settings.tiltEnabled} onValueChange={setTiltEnabled} />}
          </FabRow>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // All four sides of padding live on the ScrollView's own content, not the outer wrapper: the
  // ScrollView clips overflow at its own box edges (needed for its scroll mask), so an inset on the
  // outer View instead just shrinks where that box sits — it doesn't add any bleed room *inside* it.
  // A FAB's drop shadow (see LabeledFab) is offset 4px down with an 8px blur, so it needs clearance
  // on every side but not the same amount each way: 12 below (4 + 8, the direction the offset itself
  // pushes toward) and just 4 above (8 blur minus the 4 offset already working against it) — see
  // ControlGroupBottomSheetContent for the identical fix on a bottom-anchored sheet. The remaining 6
  // of paddingTop's 10 used to be FabRow's own marginTop instead, back when every group rendered
  // exactly one FabRow: living there worked fine as long as it only ever applied once, at the very
  // top. It moved here once branches below started rendering more than one FabRow per group (a forced
  // break between clusters — see Mirror's own comment) — marginTop on the component itself would
  // otherwise repeat before *every* one of them, stacking with the gap below into a visibly wider gap
  // between clusters than an ordinary wrapped line gets within one. paddingTop is also load-bearing
  // for TOP_SHEET_HEADER_CLEARANCE's own math (see sheetLayout.ts) — changing it shifts the first row
  // out of alignment with the menu FAB beside it, not just the shadow margin. gap reuses FAB_ROW_GAP,
  // the same constant FabRow's own internal row gap is built from, for the same reason: a forced break
  // should read exactly like an ordinary wrap, not tighter or looser.
  body: {
    gap: FAB_ROW_GAP,
    paddingBottom: 12,
    paddingHorizontal: 20,
    paddingTop: 10
  }
})
