import { useThemeSettings } from '@rific/auto-paper'
import { useVibration } from '@rific/haptic-press'
import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { PATTERN_LABELS, PATTERN_ORDER } from '@/constants/patterns'
import { TOP_SHEET_HEADER_CLEARANCE, TOP_SHEET_RIGHT_CLEARANCE } from '@/constants/sheetLayout'
import { DASH_STYLE_LABELS, DASH_STYLE_ORDER } from '@/constants/strokeDash'
import { useControlGroups } from '@/hooks/controlGroups'
import { useRotationReset } from '@/hooks/rotationReset'
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
// most of it. 'fade' has no buttons at all (see below), so its own top sheet renders empty — that's
// expected, not a bug: not every group has something that belongs in this half.
export function ControlGroupTopSheetContent() {
  const insets = useSafeAreaInsets()
  const { activeGroup } = useControlGroups()
  const { settings, setBackgroundColors, setDashStyle, setFixedSpacing, setForegroundColors, setMirrorAlternateColors, setPattern, setShakeEnabled, setShowLabels, setShowMirrorLines, setTiltEnabled } = useSwirlSettings()
  const { swapColors } = useSwapColors()
  const { resetMirrorRotation, resetRotation } = useRotationReset()
  const { notification, selection } = useVibration()
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
  const patternFabs = usePreviewOptionFabs(PATTERN_OPTIONS, settings.pattern, (value) => {
    selection()
    setPattern(value)
  })
  const dashStyleFabs = usePreviewOptionFabs(DASH_STYLE_OPTIONS, settings.dashStyle, (value) => {
    selection()
    setDashStyle(value)
  })
  const foregroundColorFabs = useColorListFabs('Foreground', settings.foregroundColors, setForegroundColors)
  const backgroundColorFabs = useColorListFabs('Background', settings.backgroundColors, setBackgroundColors)
  const appearanceFabs = useAppearanceIconFabs(themeSettings.appearance, (value) => {
    selection()
    setThemeSettings({ appearance: value })
  })

  return (
    <View style={{ paddingTop: insets.top + TOP_SHEET_HEADER_CLEARANCE, paddingRight: TOP_SHEET_RIGHT_CLEARANCE }}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {group === 'mirror' && (
          <>
            {/* Left enabled even at 0 mirror lines (where neither has anything to act on yet) rather
            than disabled until the Mirror lines slider (see the bottom sheet) is raised — these are
            first in the row, so a disabled-on-first-look pair would be most people's very first
            encounter with this sheet. Toggling them ahead of time just pre-arms the setting for
            whenever mirror lines does go above 0. */}
            <FabRow>
              <SettingToggleFab
                icon='checkerboard'
                label='Alternate colors'
                value={settings.mirrorAlternateColors}
                onValueChange={(value) => {
                  selection()
                  setMirrorAlternateColors(value)
                }}
              />
              {/* Off by default — a debug/reference aid, not part of the art. See Spiral.tsx's
              mirrorLineD. */}
              <SettingToggleFab
                icon='ray-start-end'
                label='Mirror line'
                value={settings.showMirrorLines}
                onValueChange={(value) => {
                  selection()
                  setShowMirrorLines(value)
                }}
              />
              {/* Snaps the mirror rotation angle back to 0 — meant for pairing with the bottom
              sheet's own Mirror rotation slider: turn that to 0 first, then press this to square the
              wedges back up. */}
              <ActionFab
                icon='backup-restore'
                label='Reset rotation'
                onPress={() => {
                  notification()
                  resetMirrorRotation()
                }}
              />
            </FabRow>
          </>
        )}

        {group === 'colors' && (
          <>
            {/* Matches every other group: one continuous wrapping row, Reset/Swap then each color
            list's own group label, swatches, and add button, separated by the same FabDivider every
            other group uses between logically distinct clusters — rather than this being the one
            section with its own bespoke title-plus-icon-button header and separate non-wrapping rows
            per list. */}
            <FabRow>
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
                  notification()
                  setForegroundColors(DEFAULT_FOREGROUND_COLORS)
                  setBackgroundColors(DEFAULT_BACKGROUND_COLORS)
                }}
              />
              <ActionFab
                icon='swap-horizontal'
                label='Swap'
                onPress={() => {
                  selection()
                  swapColors()
                }}
              />
              <FabDivider />
              {foregroundColorFabs.fabs}
              <FabDivider />
              {backgroundColorFabs.fabs}
            </FabRow>
            {foregroundColorFabs.dialog}
            {backgroundColorFabs.dialog}
          </>
        )}

        {group === 'line' && (
          <FabRow>
            {patternFabs}
            <FabDivider />
            {dashStyleFabs}
            <FabDivider />
            {/* Off by default: dragging the epicentre toward an edge grows the pattern's own
            radius (so it still reaches the farthest corner — see Spiral.tsx), and every
            ring/turn/ray is spaced as a fraction of that radius, so they spread out right along
            with it. This pins that spacing to what it looks like at a centered epicentre instead. */}
            <SettingToggleFab
              icon='ruler'
              label='Fixed spacing'
              value={settings.fixedSpacing}
              onValueChange={(value) => {
                selection()
                setFixedSpacing(value)
              }}
            />
          </FabRow>
        )}

        {group === 'speed' && (
          <FabRow>
            {/* Snaps the pattern's rotation angle back to 0 — pairs with the bottom sheet's own
            Rotation speed slider: turn that to 0 first, then press this to square the pattern back
            up. No effect on zoom, which has no orientation of its own to reset. */}
            <ActionFab
              icon='backup-restore'
              label='Reset rotation'
              onPress={() => {
                notification()
                resetRotation()
              }}
            />
          </FabRow>
        )}

        {group === 'settings' && (
          <FabRow>
            {appearanceFabs}
            <FabDivider />
            <SettingToggleFab
              icon='blur'
              label='Blur'
              value={themeSettings.blur}
              onValueChange={(value) => {
                selection()
                setThemeSettings({ blur: value })
              }}
            />
            {/* Governs every FAB and SettingSlider on screen — see LabeledFab/SettingSlider — not
            just this sheet's own controls. */}
            <SettingToggleFab
              icon='label'
              label='Labels'
              value={settings.showLabels}
              onValueChange={(value) => {
                selection()
                setShowLabels(value)
              }}
            />
            <FabDivider />
            <SettingToggleFab
              icon='vibrate'
              label='Shake to randomize'
              value={settings.shakeEnabled}
              onValueChange={(value) => {
                selection()
                setShakeEnabled(value)
              }}
            />
            <SettingToggleFab
              icon='axis-arrow'
              label='Tilt to warp'
              value={settings.tiltEnabled}
              onValueChange={(value) => {
                selection()
                setTiltEnabled(value)
              }}
            />
          </FabRow>
        )}
      </ScrollView>
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
