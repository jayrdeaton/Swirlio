import AsyncStorage from '@react-native-async-storage/async-storage'
import { Button } from '@rific/feedback-press'
import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Portal, Text, useTheme } from 'react-native-paper'
import Animated, { Easing, useAnimatedStyle, withTiming } from 'react-native-reanimated'

import { contrastColor } from '@/constants/fabTheme'

import { MdIcon } from './MdIcon'

const STORAGE_KEY = 'photosensitivity-warning-acknowledged'
const FADE_DURATION_MS = 250

// Shown once, ever, on first launch — the swirl's rapid color cycling and audio-reactive pulsing are
// exactly the kind of flashing content that can trigger seizures in people with photosensitive
// epilepsy. A storage read failure (rare, but AsyncStorage can throw) errs toward showing the warning
// rather than silently skipping it, since the cost of an extra tap is far lower than the cost of
// skipping a safety notice.
export function PhotosensitivityWarning() {
  const { colors } = useTheme()
  const [visible, setVisible] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let isMounted = true

    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (isMounted && value !== 'true') setVisible(true)
      })
      .catch(() => {
        if (isMounted) setVisible(true)
      })
      .finally(() => {
        if (isMounted) setChecked(true)
      })

    return () => {
      isMounted = false
    }
  }, [])

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : 0, { duration: FADE_DURATION_MS, easing: Easing.out(Easing.quad) })
  }))

  function acknowledge() {
    setVisible(false)
    AsyncStorage.setItem(STORAGE_KEY, 'true').catch(() => {
      // ignore persistence errors — worst case the warning reappears next launch
    })
  }

  // Waiting on `checked` (not just `visible`) avoids a one-frame flash of the warning while the
  // AsyncStorage read is still in flight on every launch, acknowledged or not.
  if (!checked || !visible) return null

  const ink = contrastColor(colors.primary)

  return (
    <Portal>
      <Animated.View testID='photosensitivity-warning' style={[StyleSheet.absoluteFill, styles.backdrop, animatedStyle]}>
        <View style={[styles.card, { backgroundColor: colors.primary }]}>
          <MdIcon name='alert' size={32} color={ink} />
          <Text variant='titleMedium' style={[styles.title, { color: ink }]}>
            Photosensitivity warning
          </Text>
          <Text style={[styles.body, { color: ink }]}>This app displays rapidly flashing, pulsing, and color-cycling patterns that may trigger seizures in people with photosensitive epilepsy. Stop using the app if you experience dizziness, altered vision, eye or muscle twitching, or disorientation.</Text>
          <Button mode='contained' buttonColor={ink} textColor={colors.primary} onPress={acknowledge}>
            I understand
          </Button>
        </View>
      </Animated.View>
    </Portal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center'
  },
  body: {
    textAlign: 'center'
  },
  card: {
    alignItems: 'center',
    borderRadius: 16,
    gap: 12,
    maxWidth: 360,
    padding: 24,
    width: '85%'
  },
  title: {
    textAlign: 'center'
  }
})
