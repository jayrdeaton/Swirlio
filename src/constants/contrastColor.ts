import { isDarkColor } from '@rific/auto-paper'

// A twin of @rific/auto-paper's getContrastColor, which isn't in the installed 0.7.0 build yet —
// this is 3 lines, not worth pinning to an unpublished version to share. Delete once auto-paper
// republishes and Swirlio bumps its dependency.
export function getContrastColor(hex: string): string {
  return isDarkColor(hex) ? '#ffffff' : '#000000'
}
