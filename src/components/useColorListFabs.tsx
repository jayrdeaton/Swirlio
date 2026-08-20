import { Dialog, getContrastColor } from '@rific/auto-paper'
import { Button, TouchableOpacity, useHoldToRepeat } from '@rific/feedback-press'
import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from 'react-native-paper'

import { NEUTRAL_AND_VIVID_COLORS } from '@/constants/colorSwatches'
import { randomHexColor } from '@/constants/randomColor'

import { ActionFab } from './ActionFab'
import { LabeledFab } from './LabeledFab'
import { MdIcon, resolveIcon } from './MdIcon'

const SWATCH_SIZE = 44
const SELECTED_RING_WIDTH = 3
const RESTING_RING_WIDTH = 1
// Same delay/repeat feel as every other hold-to-repeat FAB in this app (OnScreenControls' own
// TRANSPORT_LONG_PRESS_MS/HOLD_REPEAT_MS) — a local duplicate, not a shared import, matching this
// codebase's own "small local caps/timings stay duplicated per file" convention (see index.tsx's own
// MAX_PARTICLE_RAINBOW_SOUP_COLORS comment for the same reasoning applied to a cap instead of a
// timing).
const GROW_LONG_PRESS_MS = 400

// 'add' appends a new colour at the end of the list. A number opens that slot for editing — pick a
// swatch to replace it, or remove it outright. null closes the dialog.
type DialogState = 'add' | number | null

export type ColorListFabs = {
  // A flat array, not a single component: FabRow measures each of its own direct JSX children to
  // decide which dividers to hide, via React.Children.toArray — that only sees literal top-level
  // children, not whatever a custom component's own render happens to return, so a wrapping
  // component here would read as one opaque child instead of several individually-measurable ones
  // (see usePreviewOptionFabs for the same reasoning). Spreading this directly as {fabs} in JSX keeps
  // every FAB — the group's own label, its swatches, its add button — a real sibling FabRow can see.
  fabs: React.ReactNode[]
  // The pick-a-colour dialog this list's own FABs open — kept separate from `fabs` (rather than
  // folded into the array) since it isn't a row item itself and renders its own overlay regardless of
  // where in the tree it's mounted; the caller places it once, outside the row.
  dialog: React.ReactNode
}

// Colour identity here is positional (a slot in the array), not a set of unique hexes: the swatches
// are keyed by index and can repeat the same colour, which is deliberate — a colour appearing twice
// in the list just makes the cycle linger there longer. That's why editing a swatch targets its index
// rather than toggling a hex's membership: a Set-style model can't represent two slots holding the
// same colour independently.
export function useColorListFabs(label: string, colors: string[], onChange: (colors: string[]) => void, maxColors: number): ColorListFabs {
  const { colors: themeColors } = useTheme()
  const [dialogState, setDialogState] = useState<DialogState>(null)

  const editingIndex = typeof dialogState === 'number' ? dialogState : null
  const editingColor = editingIndex != null ? colors[editingIndex] : null

  const pickSwatch = (hex: string) => {
    if (dialogState === 'add') {
      onChange([...colors, hex])
    } else if (editingIndex != null) {
      onChange(colors.map((color, index) => (index === editingIndex ? hex : color)))
    }
    setDialogState(null)
  }

  const removeEditing = () => {
    // Always leave at least one colour behind — an empty list has nothing to draw.
    if (editingIndex == null || colors.length <= 1) return
    onChange(colors.filter((_, index) => index !== editingIndex))
    setDialogState(null)
  }

  // The + button's own hold action — same "keep going while held" shape as OnScreenControls' own
  // growForeground/growParticleColors transport-row pair, just reachable from the drawer's own + FAB
  // directly instead of only from the canvas. Capped at maxColors, same reasoning as those two: a
  // backstop so a long hold can't grow the list without bound, not a limit the design itself wants.
  const growColors = () => {
    if (colors.length >= maxColors) return
    onChange([...colors, randomHexColor()])
  }
  const growColorsHold = useHoldToRepeat(growColors, GROW_LONG_PRESS_MS)

  const fabs: React.ReactNode[] = [
    // Leads the row, not trails it (its original position): while + is held for its own hold-to-grow
    // action (growColorsHold above), each newly-appended swatch has to land *after* wherever + already
    // sits on screen, never push + itself sideways out from under the finger still holding it —
    // trailing would do exactly that on every single tick of a hold, since a swatch row grows by
    // appending at the end.
    <ActionFab key='add' testID={`color-list-add-${label}`} icon='plus' label='Add color' onPress={() => setDialogState('add')} onLongPress={growColorsHold.onLongPress} onPressOut={growColorsHold.onPressOut} delayLongPress={GROW_LONG_PRESS_MS} />,
    ...colors.map((hex, index) => (
      // No icon — the swatch's own fill color is the payload, matching the pattern/dash pickers'
      // "square FAB" language instead of the small round dots this used to be. The first swatch wears
      // the group's own name ("Foreground"/"Background") as its caption instead of its hex — that's
      // the only label this group gets, rather than a separate non-interactive label FAB taking up a
      // slot of its own. Still index 0 of the color list itself, not the row's own first FAB — the +
      // button leads the row now (see above), this is just which swatch carries the label.
      <LabeledFab key={index} testID={`color-dot-${index}`} icon={() => null} label={index === 0 ? label : hex} colorOverride={{ backgroundColor: hex, iconColor: 'transparent' }} onPress={() => setDialogState(index)} />
    ))
  ]

  const dialog = (
    <Dialog visible={dialogState !== null} onDismiss={() => setDialogState(null)}>
      <Dialog.Content>
        <View style={styles.swatchGrid}>
          {NEUTRAL_AND_VIVID_COLORS.map(({ value: hex }) => {
            const selected = hex === editingColor
            return (
              <TouchableOpacity key={hex} testID={`color-swatch-${hex}`} onPress={() => pickSwatch(hex)} style={[styles.swatch, { backgroundColor: hex, borderColor: selected ? getContrastColor(hex) : themeColors.outlineVariant, borderWidth: selected ? SELECTED_RING_WIDTH : RESTING_RING_WIDTH }]}>
                {selected && <MdIcon name='check' size={18} color={getContrastColor(hex)} />}
              </TouchableOpacity>
            )
          })}
        </View>
        {editingIndex != null && colors.length > 1 && (
          <Button testID='color-remove' mode='outlined' icon={resolveIcon('trash-can-outline')} textColor={themeColors.error} style={styles.removeButton} onPress={removeEditing}>
            Remove
          </Button>
        )}
      </Dialog.Content>
    </Dialog>
  )

  return { fabs, dialog }
}

const styles = StyleSheet.create({
  removeButton: {
    alignSelf: 'center',
    marginTop: 12
  },
  swatch: {
    alignItems: 'center',
    borderRadius: SWATCH_SIZE / 2,
    height: SWATCH_SIZE,
    justifyContent: 'center',
    width: SWATCH_SIZE
  },
  swatchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingTop: 12
  }
})
