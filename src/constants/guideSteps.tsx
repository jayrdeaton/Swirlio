import type { GuideStep } from '@tastic/hud/guide'

import { GuideDragSpin, GuideRevealZones, GuideSwapColors, GuideTargetFan, GuideTiltShake, GuideTwoFingers } from '@/components/GuideArt'

interface GuideStepsInput {
  // A touch screen vs. a desktop browser (useIsTouchPrimaryDevice()): a touch player taps and
  // twists, a desktop player clicks and scrolls, and has no twist or two-finger tap at all.
  touch: boolean
  // Native iOS/Android vs. web: tilt and shake only exist natively (both are hidden on web, see
  // ControlGroupTopSheetContent), so web's fourth card teaches the tap-to-swap alone.
  native: boolean
}

// The five cards of Swirlio's how-to-play flow. Pure and hook-free so it's trivially testable;
// GuideHost feeds it useIsTouchPrimaryDevice() and the platform, and memoizes the result.
//
// These are the things a first-time player can't work out from the screen, at fresh-install
// defaults (Pattern target, 0 mirror lines, tilt and shake on). Every sentence is checked against the
// code:
// - Drag and Spin: a drag that starts on the pattern's center moves it, one that starts farther out
//   spins it as it circles (useEpicenter.ts's inner drag vs. outer field). Throwing and the outer
//   field's zoom axis are left for the player to find.
// - Pinch and Twist: what they change depends on the target (index.tsx's pinch/rotation gestures), so
//   the card says "reshape" rather than listing ten effects. A two-finger tap is always the next
//   pattern. On desktop web the wheel/trackpad scroll is the pinch (index.tsx's wheel handler), and
//   there is no twist or two-finger tap.
// - Pick a Target: the bottom-center button opens the target fan (OnScreenControls). The touch copy
//   points at the one combination that makes the kaleidoscope: a fresh install has 0 mirror lines,
//   and twisting with Mirror picked is how lines get added (it's exempt from the 0-lines fallback to
//   Pattern). Desktop can't twist, so it lists the targets instead.
// - Tap, Tilt, Shake: a one-finger tap swaps the colors whatever the target. Tilt and shake are on by
//   default on native.
// - Controls Fade: the controls auto-hide after 5 seconds by default, and EdgeRevealZones brings them
//   back. The top-left zone is left out on purpose: tapping it also pauses, which a player following
//   the card wouldn't expect. On desktop, pointing at a zone is enough.
//
// Copy rules (the fleet's, see Solitaire's guideSteps.tsx): Title Case titles, the default one-word
// buttons, bodies of 90 characters or less, no questions, no filler, never tell a desktop player to tap
// or a touch player to click. Every touch body also fits in two lines on a 375pt-wide phone (checked
// live on web at that width).
export function getGuideSteps({ touch, native }: GuideStepsInput): GuideStep[] {
  const pointer = touch ? 'finger' : 'mouse'

  return [
    {
      title: 'Drag and Spin',
      body: 'Drag the center to move the swirl. Drag in circles around it to make it spin.',
      art: <GuideDragSpin pointer={pointer} />
    },
    touch
      ? {
          title: 'Pinch and Twist',
          body: 'Pinch and twist to reshape it. Tap with two fingers for a new pattern.',
          art: <GuideTwoFingers pointer={pointer} />
        }
      : {
          title: 'Scroll to Reshape',
          body: 'Scroll over the swirl, or pinch on a trackpad, to reshape it.',
          art: <GuideTwoFingers pointer={pointer} />
        },
    {
      title: 'Pick a Target',
      body: touch ? 'The bottom button picks what you move. Pick Mirror and twist for a kaleidoscope.' : 'The bottom button picks what you move: Pattern, Crop, Particles, Mirror, or Gravity.',
      art: <GuideTargetFan />
    },
    native
      ? {
          title: 'Tap, Tilt, Shake',
          body: 'Tap to swap colors. Tilt to roll the swirl around. Shake for a whole new look.',
          art: <GuideTiltShake />
        }
      : {
          title: touch ? 'Tap to Swap' : 'Click to Swap',
          body: `${touch ? 'Tap' : 'Click'} anywhere to swap the foreground and background colors.`,
          art: <GuideSwapColors pointer={pointer} />
        },
    {
      title: 'Controls Fade',
      body: `Controls fade out. ${touch ? 'Tap' : 'Point at'} the bottom edge or top right corner to bring them back.`,
      art: <GuideRevealZones />
    }
  ]
}
