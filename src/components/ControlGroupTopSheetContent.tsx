import { defaultThemeSettings, useThemeSettings } from '@rific/auto-paper'
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { PATTERN_LABELS, PATTERN_ORDER } from '@/constants/patterns'
import { TOP_SHEET_HEADER_CLEARANCE, TOP_SHEET_RIGHT_CLEARANCE } from '@/constants/sheetLayout'
import { DASH_STYLE_LABELS, DASH_STYLE_ORDER } from '@/constants/strokeDash'
import { useControlGroups } from '@/hooks/controlGroups'
import { useSwirlRandomize } from '@/hooks/swirlRandomize'
import { useSwirlReset } from '@/hooks/swirlReset'
import { useSwapColors } from '@/hooks/useSwapColors'
import { DEFAULT_BACKGROUND_COLORS, DEFAULT_FOREGROUND_COLORS, useSwirlSettings } from '@/hooks/useSwirlSettings'

import { ActionFab } from './ActionFab'
import { DashStyleIcon } from './DashStyleIcon'
import { FabDivider } from './FabDivider'
import { FabRow } from './FabRow'
import { PatternIcon } from './PatternIcon'
import { SettingToggleFab } from './SettingToggleFab'
import { useAppearanceIconFabs } from './useAppearanceIconFabs'
import { useColorListFabs } from './useColorListFabs'
import { usePreviewOptionFabs } from './usePreviewOptionFabs'

const PATTERN_OPTIONS = PATTERN_ORDER.map((pattern) => ({
  value: pattern,
  label: PATTERN_LABELS[pattern],
  renderIcon: ({ color, size }: { color: string; size: number }) => <PatternIcon pattern={pattern} color={color} size={size} />
}))

const DASH_STYLE_OPTIONS = DASH_STYLE_ORDER.map((dashStyle) => ({
  value: dashStyle,
  label: DASH_STYLE_LABELS[dashStyle],
  renderIcon: ({ color, size }: { color: string; size: number }) => <DashStyleIcon dashStyle={dashStyle} color={color} size={size} />
}))

// The buttons/pickers half of the group sheet — see ControlGroupBottomSheetContent for the sliders
// half. Split into two independently-anchored sheets (this one top, sliders bottom) that open and
// close together — see controlGroups.tsx — rather than one combined sheet, so the canvas stays
// visible through the middle of the screen while either is open instead of one big block covering
// most of it.
export function ControlGroupTopSheetContent() {
  const insets = useSafeAreaInsets()
  const { activeGroup } = useControlGroups()
  const { settings, resetSettings, setBackgroundColors, setCropShaped, setDashStyle, setFixedSpacing, setForegroundColors, setHoleShaped, setMirrorAlternateColors, setPattern, setShakeEnabled, setShowGravityMarker, setShowLabels, setTiltEnabled } = useSwirlSettings()
  const { swapColors } = useSwapColors()
  const { resetMirror, resetPattern } = useSwirlReset()
  const { randomizeGroup } = useSwirlRandomize()
  // App-wide look rather than a per-swirl setting, so it lives in @rific/auto-paper's own
  // ThemeSettingsContext instead of useSwirlSettings — see _layout.tsx's MonochromeThemeBridge for
  // how `appearance` feeds back into the forced black/white accent.
  const { settings: themeSettings, set: setThemeSettings } = useThemeSettings()

  // Renders whatever the sheet was last opened to even while it's animating closed, rather than
  // going blank — same reasoning as ControlGroupProvider not resetting activeGroup on close.
  const group = activeGroup ?? 'mirror'

  // Hooks, not JSX components — see usePreviewOptionFabs for why (FabRow's smart dividers need every
  // FAB as a real flat sibling). Called unconditionally regardless of which group is active, same as
  // any other hook.
  const patternFabs = usePreviewOptionFabs(PATTERN_OPTIONS, settings.pattern, setPattern)
  const dashStyleFabs = usePreviewOptionFabs(DASH_STYLE_OPTIONS, settings.dashStyle, setDashStyle)
  const foregroundColorFabs = useColorListFabs('Foreground', settings.foregroundColors, setForegroundColors)
  const backgroundColorFabs = useColorListFabs('Background', settings.backgroundColors, setBackgroundColors)
  const appearanceFabs = useAppearanceIconFabs(themeSettings.appearance, (value) => setThemeSettings({ appearance: value }))

  return (
    <View style={{ paddingTop: insets.top + TOP_SHEET_HEADER_CLEARANCE, paddingRight: TOP_SHEET_RIGHT_CLEARANCE }}>
      <View style={styles.body}>
        {group === 'mirror' && (
          <>
            {/* Left enabled even at 0 mirror lines (where neither has anything to act on yet) rather
            than disabled until the Mirror lines slider (see the bottom sheet) is raised — these are
            first in the row, so a disabled-on-first-look pair would be most people's very first
            encounter with this sheet. Toggling them ahead of time just pre-arms the setting for
            whenever mirror lines does go above 0. */}
            <FabRow>
              <SettingToggleFab icon='checkerboard' label='Alternate colors' value={settings.mirrorAlternateColors} onValueChange={setMirrorAlternateColors} />
              {/* Rerolls mirror lines/gap/alternate-colors — same rerollUnitsByGroup slice the global
              dice FAB and shake gesture already pull 'mirror' units from (see index.tsx's
              randomizeGroup), just scoped to this group instead of every field at once. Same icon as
              the global dice FAB (OnScreenControls) for a consistent "this randomizes" affordance. */}
              <ActionFab icon='dice-multiple' label='Randomize' onPress={() => randomizeGroup('mirror')} />
              {/* Squares the wedges' rotation back to 0 AND snaps the mirror anchor back to center —
              see index.tsx's resetMirror. Used to be rotation-only, paired with a tap on the anchor
              itself to recentre it, but that tap had no fixed visual marker to aim at once the
              pattern was mirrored (there's nothing to see there, just wherever you last dragged it
              to) — this button is now the only, findable way to reach either half. Short, icon-
              disambiguated label (not "Reset mirror") matching the Colors group's own Reset/Swap
              pair below and Pattern's own reset button (see the 'pattern' branch below) — both just
              say "Reset", disambiguated only by whichever sheet happens to be open. */}
              <ActionFab icon='backup-restore' label='Reset' onPress={resetMirror} />
            </FabRow>
          </>
        )}

        {group === 'colors' && (
          <>
            {/* Matches every other group: one continuous wrapping row, each color list's own group
            label, swatches, and add button, then Swap/Reset last — separated by the same FabDivider
            every other group uses between logically distinct clusters — rather than this being the
            one section with its own bespoke title-plus-icon-button header and separate non-wrapping
            rows per list. */}
            <FabRow>
              {foregroundColorFabs.fabs}
              <FabDivider />
              {backgroundColorFabs.fabs}
              <FabDivider />
              <ActionFab icon='swap-horizontal' label='Swap' onPress={swapColors} />
              {/* Rerolls the fg/bg color pair — the same single 'colors' rerollUnitsByGroup unit the
              global dice FAB and shake gesture already reroll (see index.tsx's randomizeGroup). Same
              icon as the global dice FAB (OnScreenControls) for a consistent "this randomizes"
              affordance. */}
              <ActionFab icon='dice-multiple' label='Randomize' onPress={() => randomizeGroup('colors')} />
              <ActionFab
                icon='backup-restore'
                // Short, single-word labels here (not "Reset colors"/"Swap colors" — the icon alone
                // already disambiguates from "Reset rotation" elsewhere): a two-word caption is wider
                // than the 56pt icon it captions, so LabeledFab's column widens to fit it and the icon
                // sits inset within that wider column — stack two such insets side by side and the gap
                // between these two icons reads visibly wider than the gap anywhere else in the row,
                // even though the underlying FabRow gap is the same 12pt everywhere.
                label='Reset'
                onPress={() => {
                  setForegroundColors(DEFAULT_FOREGROUND_COLORS)
                  setBackgroundColors(DEFAULT_BACKGROUND_COLORS)
                }}
              />
            </FabRow>
            {foregroundColorFabs.dialog}
            {backgroundColorFabs.dialog}
          </>
        )}

        {group === 'pattern' && (
          <FabRow>
            {patternFabs}
            <FabDivider />
            {/* Crop/Hole live here rather than in Line: now that either can trace the active
            pattern's own outline (see Spiral.tsx's shapedClipPoints), they're as much a "what shape
            is this" decision as Sides/Points/Petals below is, not just a stroke-rendering knob.
            Left enabled for every pattern, including Spiral/Starburst/Rings — those have no closed
            boundary of their own and always clip to a plain circle regardless — but pre-arming the
            toggle here means it's already set the way the user wants the moment they switch to
            Polygon/Star/Flower, same "toggleable ahead of having anything to act on" reasoning as
            Alternate colors above. Distinct icons even though the two toggles are
            otherwise identical in shape (a plain outline for the outer Crop, a bounded/contained
            outline for the inner Hole) — matching this app's own one-icon-per-control convention
            rather than reusing Sides' own vector-polygon glyph, which reads as "how many points",
            not "trace the shape". */}
            <SettingToggleFab icon='shape-outline' label='Crop shape' value={settings.cropShaped} onValueChange={setCropShaped} />
            <SettingToggleFab icon='contain' label='Hole shape' value={settings.holeShaped} onValueChange={setHoleShaped} />
            <FabDivider />
            {/* Rerolls pattern+sides, crop radius/shaped, and hole radius/shaped — the 'pattern'
            rerollUnitsByGroup slice the global dice FAB and shake gesture already pull from (see
            index.tsx's randomizeGroup), just scoped to this group. Same icon as the global dice FAB
            (OnScreenControls) for a consistent "this randomizes" affordance. */}
            <ActionFab icon='dice-multiple' label='Randomize' onPress={() => randomizeGroup('pattern')} />
            {/* Squares the pattern's rotation back to 0 AND snaps the epicentre back to center —
            see index.tsx's resetPattern. No effect on zoom, which has no orientation of its own to
            reset. Used to be rotation-only, paired with a tap on the epicentre itself to recentre
            it, but that tap had no fixed visual marker to aim at once the pattern was mirrored —
            this button is now the only, findable way to reach either half. Short, icon-disambiguated
            label matching Mirror's own reset button (see the 'mirror' branch above) and the Colors
            group's Reset/Swap pair below — all three just say "Reset", disambiguated only by
            whichever sheet happens to be open. */}
            <ActionFab icon='backup-restore' label='Reset' onPress={resetPattern} />
          </FabRow>
        )}

        {group === 'line' && (
          <FabRow>
            {dashStyleFabs}
            <FabDivider />
            {/* Fixed spacing lives here rather than in Pattern: it's paired with Tightness (see the
            bottom sheet), and together they're about how densely the rendered strokes are packed,
            not which shape is showing — Crop/Hole shape moved the other way for the same reasoning
            (see the 'pattern' branch above). Off by default: dragging the epicentre toward an edge
            grows the pattern's own radius (so it still reaches the farthest corner — see
            Spiral.tsx), and every ring/turn/ray is spaced as a fraction of that radius, so they
            spread out right along with it. This pins that spacing to what it looks like at a
            centered epicentre instead. */}
            <SettingToggleFab icon='ruler' label='Fixed spacing' value={settings.fixedSpacing} onValueChange={setFixedSpacing} />
            <FabDivider />
            {/* Rerolls dash style, tightness, and stroke width — the 'line' rerollUnitsByGroup slice
            the global dice FAB and shake gesture already pull from (see index.tsx's randomizeGroup).
            No Reset button in this group today (unlike Mirror/Colors/Pattern above) — Randomize is
            the first per-field action to land here. Same icon as the global dice FAB
            (OnScreenControls) for a consistent "this randomizes" affordance. */}
            <ActionFab icon='dice-multiple' label='Randomize' onPress={() => randomizeGroup('line')} />
          </FabRow>
        )}

        {group === 'settings' && (
          <FabRow>
            {appearanceFabs}
            <FabDivider />
            <SettingToggleFab icon='blur' label='Blur' value={themeSettings.blur} onValueChange={(value) => setThemeSettings({ blur: value })} />
            {/* Governs every FAB and SettingSlider on screen — see LabeledFab/SettingSlider — not
            just this sheet's own controls. */}
            <SettingToggleFab icon='label' label='Labels' value={settings.showLabels} onValueChange={setShowLabels} />
            <FabDivider />
            <SettingToggleFab icon='vibrate' label='Shake to randomize' value={settings.shakeEnabled} onValueChange={setShakeEnabled} />
            <SettingToggleFab icon='axis-arrow' label='Tilt to roll' value={settings.tiltEnabled} onValueChange={setTiltEnabled} />
            {/* Temporary — see useSwirlSettings.tsx's own showGravityMarker comment for why this is
            expected to move once gravity becomes its own gestureTarget rather than staying a
            standalone toggle here. */}
            <SettingToggleFab icon='target' label='Gravity marker' value={settings.showGravityMarker} onValueChange={setShowGravityMarker} />
            <FabDivider />
            {/* The one button in this group that isn't its own preference — every slider and toggle
            across all five groups, plus appearance/blur (themeSettings, a separate persisted store
            from useSwirlSettings — see @rific/auto-paper's ThemeProvider) and the pattern/mirror
            rotation+position the per-group Reset buttons above already square back up (resetPattern/
            resetMirror), in one tap. 'Reset' alone (matching Mirror/Pattern/Colors' own buttons) would
            read as scoped to whichever sheet happens to be open, same as those three — 'Reset all'
            says plainly that this one isn't. The mic toggle is the one exception — see
            resetSettings' own comment for why it survives this.
            themeSettings' own `color` field is deliberately left out of this reset (every other field
            resets to defaultThemeSettings' value, color doesn't): it isn't a user preference to reset
            at all, it's a live mirror of light/dark mode that MonochromeThemeBridge (_layout.tsx) keeps
            in sync — resetting it to the library's own baseline accent (a purple, defaultThemeSettings'
            own seed color, meant for apps that don't override it the way this one does) would fight
            that bridge, which only re-derives color when light/dark mode itself actually changes, not
            on every settings change — so the reset purple would otherwise sit there undoing the app's
            entire black/white theming until the next time light/dark mode flips or the app restarts. */}
            <ActionFab
              icon='backup-restore'
              label='Reset all'
              onPress={() => {
                resetSettings()
                setThemeSettings({ appearance: defaultThemeSettings.appearance, blur: defaultThemeSettings.blur, blurTint: defaultThemeSettings.blurTint, harmony: defaultThemeSettings.harmony })
                resetPattern()
                resetMirror()
              }}
            />
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
  // ControlGroupBottomSheetContent for the identical fix on a bottom-anchored sheet. paddingTop is
  // also load-bearing for TOP_SHEET_HEADER_CLEARANCE's own math (see sheetLayout.ts) — changing it
  // shifts the first row out of alignment with the menu FAB beside it, not just the shadow margin.
  body: {
    gap: 4,
    paddingBottom: 12,
    paddingHorizontal: 20,
    paddingTop: 4
  }
})
