import React from 'react'

import { PARTICLE_SHAPE_LABELS, PARTICLE_SHAPE_ORDER, ParticleShape } from '@/constants/particleShapes'

import { ParticleIcon } from './ParticleIcon'
import { PreviewOption, usePreviewOptionToggleFabs } from './usePreviewOptionFabs'

const PARTICLE_SHAPE_OPTIONS: PreviewOption<ParticleShape>[] = PARTICLE_SHAPE_ORDER.map((shape) => ({
  value: shape,
  label: PARTICLE_SHAPE_LABELS[shape],
  renderIcon: ({ color, size }) => <ParticleIcon shape={shape} color={color} size={size} />
}))

// Same usePreviewOptionToggleFabs shape as useColorListFabs — a hook, not a component, so
// ControlGroupTopSheetContent's own FabRow sees every FAB as a real flat sibling instead of one
// opaque child (see usePreviewOptionFabs's own comment for why). Multi-select: live beads resolve a
// random pick from whichever shapes are enabled here (see Spiral.tsx's particleBucketPaths).
export function useParticleShapeIconFabs(values: ParticleShape[], onChange: (shapes: ParticleShape[]) => void): React.ReactNode[] {
  return usePreviewOptionToggleFabs(PARTICLE_SHAPE_OPTIONS, values, onChange)
}
