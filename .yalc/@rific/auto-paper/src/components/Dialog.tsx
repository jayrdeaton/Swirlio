import React, { useEffect, useRef, useState } from 'react'
import { Animated, BackHandler, Easing, Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import { Dialog as PaperDialog, type DialogActionsProps, type DialogContentProps, type DialogProps as PaperDialogProps, type DialogScrollAreaProps, type DialogTitleProps, Portal, useTheme } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useBlur } from '../BlurContext'
import { BlurView } from './BlurView'

// `style` is narrowed to a plain ViewStyle: unlike react-native-paper's Dialog, the surface here is
// never wrapped in Animated.View, so it can't drive an Animated-value style the way upstream's can.
export type DialogProps = Omit<PaperDialogProps, 'style'> & {
  blur?: boolean
  style?: StyleProp<ViewStyle>
}

// Matches react-native-paper's Modal: DEFAULT_DURATION * theme.animation.scale, eased the same way,
// so toggling blur never changes how the dialog animates in/out.
const ANIMATION_DURATION = 220

// Minimum breathing room between the card and the screen edge, clamped up from safe-area insets.
const DIALOG_MARGIN = 32

function DialogComponent({ blur: blurProp, dismissable = true, dismissableBackButton = dismissable, visible, onDismiss, children, style, testID = 'dialog' }: DialogProps) {
  const blur = useBlur(blurProp)
  const theme = useTheme()
  const { colors, isV3, roundness } = theme
  const { scale } = theme.animation
  const { bottom, left, right, top } = useSafeAreaInsets()
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current
  const [mounted, setMounted] = useState(visible)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      Animated.timing(opacity, { duration: scale * ANIMATION_DURATION, easing: Easing.out(Easing.cubic), toValue: 1, useNativeDriver: true }).start()
    } else {
      Animated.timing(opacity, { duration: scale * ANIMATION_DURATION, easing: Easing.out(Easing.cubic), toValue: 0, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false)
      })
    }
  }, [visible])

  useEffect(() => {
    if (!visible) return undefined
    const onHardwareBackPress = () => {
      if (dismissable || dismissableBackButton) onDismiss?.()
      return true
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBackPress)
    return () => subscription.remove()
  }, [dismissable, dismissableBackButton, onDismiss, visible])

  if (!mounted) return null

  // Mirrors react-native-paper's own Dialog: the first child gets extra top spacing so the
  // header sits the same distance from the edge whether the surface is blurred or solid.
  const content = React.Children.toArray(children)
    .filter((child) => child != null && typeof child !== 'boolean')
    .map((child, i) => {
      if (isV3) {
        if (i === 0 && React.isValidElement<DialogContentProps>(child)) {
          return React.cloneElement(child, { style: [{ marginTop: 24 }, child.props.style] })
        }
      }
      if (i === 0 && React.isValidElement<DialogContentProps>(child) && child.type === PaperDialog.Content) {
        return React.cloneElement(child, { style: [{ paddingTop: 24 }, child.props.style] })
      }
      return child
    })

  const borderRadius = (isV3 ? 7 : 1) * roundness

  return (
    <Portal>
      <Animated.View accessibilityLiveRegion='polite' accessibilityViewIsModal pointerEvents={visible ? 'box-none' : 'none'} style={[StyleSheet.absoluteFill, { opacity }]} testID={testID}>
        <Pressable accessibilityLabel='Close modal' accessibilityRole='button' disabled={!dismissable} onPress={dismissable ? onDismiss : undefined} style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }]} testID={`${testID}-backdrop`} />
        <View pointerEvents='box-none' style={[styles.wrapper, { marginBottom: bottom, marginTop: top, paddingHorizontal: Math.max(left, right, DIALOG_MARGIN) }]} testID={`${testID}-wrapper`}>
          <BlurView blur={blur} style={[styles.card, { borderRadius }, style]} testID={`${testID}-surface`}>
            {content}
          </BlurView>
        </View>
      </Animated.View>
    </Portal>
  )
}

DialogComponent.Title = PaperDialog.Title as React.FC<DialogTitleProps>
DialogComponent.Content = PaperDialog.Content as React.FC<DialogContentProps>
DialogComponent.Actions = PaperDialog.Actions as React.FC<DialogActionsProps>
DialogComponent.ScrollArea = PaperDialog.ScrollArea as React.FC<DialogScrollAreaProps>

export const Dialog = DialogComponent

const styles = StyleSheet.create({
  // Width cap keeps dialogs card-sized on wide viewports (web/tablet); no effect on phones.
  card: { alignSelf: 'center', maxWidth: 400, overflow: 'hidden', width: '100%' },
  wrapper: { flex: 1, justifyContent: 'center', paddingVertical: DIALOG_MARGIN }
})
