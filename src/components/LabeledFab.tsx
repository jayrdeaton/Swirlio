import { BlurView } from '@rific/auto-paper'
import { FAB } from '@rific/haptic-press'
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Text, useTheme } from 'react-native-paper'

import { disabledFabTheme, disabledIconColor, VISIBLE_HAIRLINE_WIDTH } from '@/constants/fabTheme'
import { useSwirlSettings } from '@/hooks/useSwirlSettings'

import { resolveIcon } from './MdIcon'
import { useToggleFabAppearance } from './useToggleFabAppearance'

const LABEL_MAX_WIDTH = 72
// react-native-paper's own v3 FAB sizing (FAB/utils.ts's v3SmallSize/v3MediumSize) — not configurable
// from here, so mirrored as constants rather than guessed.
export const FAB_HEIGHT_SMALL = 40
export const FAB_HEIGHT_MEDIUM = 56
// FAB/utils.ts's getFabStyle: borderRadius is roundness * 3 for a small FAB, * 4 for medium — mirrored
// here for the same reason as the sizes above, so a blur backdrop clips to the exact same rounded
// shape as the FAB sitting on top of it, not a guessed circle.
export const BORDER_RADIUS_MULTIPLIER_SMALL = 3
export const BORDER_RADIUS_MULTIPLIER_MEDIUM = 4

type LabeledFabColorProps =
  // The common case — an on/off state, colored via useToggleFabAppearance below.
  | { active: boolean; colorOverride?: undefined }
  // The one caller (useColorListFabs' swatches) where the FAB's own fill IS the payload — the user's
  // actual chosen color — rather than a toggle state to represent. Bypasses useToggleFabAppearance
  // entirely rather than trying to force an arbitrary color through an "active" lens that doesn't
  // apply to it.
  | { active?: undefined; colorOverride: { backgroundColor: string; iconColor: string } }

type LabeledFabProps = LabeledFabColorProps & {
  icon: string | ((props: { color: string; size: number }) => React.ReactNode)
  label: string
  disabled?: boolean
  // Every FAB shares paper's own generic default ('fab') unless a caller needs to tell instances of
  // the same kind apart — a row of same-icon swatches (see ColorListEditor), not group triggers or
  // toggles, which are already distinguishable by icon/aria-label alone.
  testID?: string
  onPress: () => void
}

// A single square icon button, optionally captioned — every FAB-style control on screen (group
// triggers, toggles, the pattern/dash/appearance pickers) goes through this so the "show labels"
// setting affects every one of them the same way: bigger with a caption underneath when on, compact
// icon-only when off, rather than each control deciding for itself. Its on/off colors — and whether a
// blur backdrop shows behind the off state — come from useToggleFabAppearance, the same hook
// OnScreenControls' on-canvas GlassToggleFab uses, so a toggle looks and behaves identically whether
// it's floating over the canvas or sitting inside a sheet (see that hook's own comment for why those
// two used to drift). ActionFab (no on/off state at all — a one-shot action) just always passes
// active={true}, reusing that branch's solid-fill-plus-contrasting-icon look rather than computing its
// own copy of the same two colors.
export function LabeledFab({ icon, label, active, colorOverride, disabled = false, testID, onPress }: LabeledFabProps) {
  const { settings } = useSwirlSettings()
  const { colors, roundness } = useTheme()
  // Called unconditionally regardless of which color mode this instance is in — rules of hooks — and
  // simply unused below when colorOverride is set. active ?? false rather than a real fallback value:
  // the type above guarantees colorOverride is set whenever active isn't, so this is never anything
  // other than an unused, inert computation in that branch.
  const toggleAppearance = useToggleFabAppearance(active ?? false)
  const { backgroundColor, iconColor, borderColor, blurEnabled, tintOpacity } = colorOverride ? { backgroundColor: colorOverride.backgroundColor, iconColor: colorOverride.iconColor, borderColor: colorOverride.iconColor, blurEnabled: false, tintOpacity: 1 } : toggleAppearance
  const size = settings.showLabels ? 'medium' : 'small'
  const diameter = size === 'small' ? FAB_HEIGHT_SMALL : FAB_HEIGHT_MEDIUM
  const borderRadius = (size === 'small' ? BORDER_RADIUS_MULTIPLIER_SMALL : BORDER_RADIUS_MULTIPLIER_MEDIUM) * (roundness ?? 4)
  // Never shown while disabled — that state's own fill comes from disabledFabTheme below, not
  // useToggleFabAppearance, so there's nothing this blur would be enhancing. Never shown for a
  // colorOverride instance either — a fixed arbitrary color has no off-state tint for blur to
  // enhance. Never shown while active — that fill is already fully opaque, occluding anything
  // blurred behind it.
  const showBlurBackdrop = !disabled && !colorOverride && !active
  // borderColor tracks the icon color, not colors.primary directly — see useToggleFabAppearance's own
  // comment for why. disabledIconColor(colors.primary) rather than that borderColor while disabled:
  // FAB ignores color/backgroundColor entirely in that state (see react-native-paper's FAB/utils.ts
  // getForegroundColor/getBackgroundColor), always rendering disabledFabTheme's own onSurfaceDisabled
  // color instead — the border needs to track THAT, not whichever color was computed for a state paper
  // isn't actually using right now.
  // height/width/boxSizing: react-native-paper's FAB Surface has no size of its own — it's sized
  // purely by its content (fabStyle's own 40/56 box) plus whatever border this style adds. Without an
  // explicit box-sizing, that border is added OUTSIDE the content box (RN's default), growing the
  // Surface a couple pixels taller than `diameter` — which the wrapper's default cross-axis stretch
  // above happens to clip back down on width but not on height (height is the main axis in a column
  // flex, never stretched), so the Surface ends up a couple pixels TALLER than the `diameter`-sized
  // BlurView backdrop behind it, both sharing the same top edge — a sliver of whatever's behind both
  // shows through at the bottom, between the backdrop's edge and the border tracing the (taller)
  // Surface. boxSizing: 'border-box' is what makes an explicit height/width actually include the
  // border instead of adding to it, so the Surface's true rendered box matches `diameter` exactly, on
  // both axes, same as the backdrop it needs to align with.
  const fabStyle = { backgroundColor: showBlurBackdrop ? 'transparent' : backgroundColor, borderColor: disabled ? disabledIconColor(colors.primary) : borderColor, borderWidth: VISIBLE_HAIRLINE_WIDTH, height: diameter, width: diameter, boxSizing: 'border-box' as const }
  const backdropStyle = { borderRadius, overflow: 'hidden' as const }
  const wrapperStyle = { height: diameter, width: diameter }

  return (
    <View style={styles.column}>
      <View style={wrapperStyle}>
        {showBlurBackdrop && <BlurView blur={blurEnabled} tintColor={backgroundColor} tintOpacity={tintOpacity} style={[StyleSheet.absoluteFill, backdropStyle]} />}
        <FAB testID={testID} size={size} icon={resolveIcon(icon)} disabled={disabled} accessibilityLabel={label} accessibilityState={{ disabled, selected: active }} color={iconColor} style={fabStyle} theme={disabledFabTheme(colors.primary)} onPress={onPress} />
      </View>
      {/* One word per line via an explicit break, rather than letting a long caption wrap on its
      own: a browser sizes an auto-width block to its max-width whenever IT has to wrap the text
      itself (CSS's fit-content clamps toward max-width, not toward the width of the wrapped line
      it actually produces), so any caption over LABEL_MAX_WIDTH — "Gravity marker", "Alternate
      colors", "Shake to randomize" — ended up in a column notably wider than every single-word
      neighbour's, throwing off FabRow's otherwise-even gaps (see the FAB that follows it). Pre-
      breaking at each word sidesteps that: every word here is short enough to render on its own
      line without wrapping, so the box always shrinks to its widest *word*, which stays under the
      icon's own width for every caption currently in the app. */}
      {settings.showLabels && (
        <Text variant='labelSmall' style={styles.label}>
          {label.split(' ').join('\n')}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  column: {
    alignItems: 'center',
    gap: 4
  },
  label: {
    maxWidth: LABEL_MAX_WIDTH,
    textAlign: 'center'
  }
})
