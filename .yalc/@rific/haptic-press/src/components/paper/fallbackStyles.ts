import { StyleSheet } from 'react-native'

// Minimal, dependency-free styling used when `paper` isn't injected into
// HapticPressProvider: functional, not a Material Design reproduction. Consumers who want
// the real look inject `paper` (see PaperContext.ts / HapticPressProvider's `paper` prop).
export const fallbackColors = {
  background: '#e6e6e6',
  border: '#9e9e9e',
  disabled: '#c7c7c7',
  text: '#1c1c1c',
  tint: '#3a3a3a'
}

export const fallbackStyles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: fallbackColors.background,
    borderRadius: 6,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  buttonOutlined: {
    backgroundColor: 'transparent',
    borderColor: fallbackColors.border,
    borderWidth: 1
  },
  buttonText: {
    color: fallbackColors.text,
    fontWeight: '600'
  },
  card: {
    backgroundColor: fallbackColors.background,
    borderRadius: 8,
    overflow: 'hidden'
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: 8
  },
  cardContent: {
    padding: 16
  },
  cardCover: {
    height: 160,
    width: '100%'
  },
  cardTitleText: {
    color: fallbackColors.text,
    fontSize: 16,
    fontWeight: '700'
  },
  disabled: {
    opacity: 0.5
  },
  checkboxBox: {
    alignItems: 'center',
    borderColor: fallbackColors.tint,
    borderRadius: 3,
    borderWidth: 2,
    height: 20,
    justifyContent: 'center',
    width: 20
  },
  checkboxMark: {
    color: fallbackColors.tint,
    fontSize: 14,
    fontWeight: '700'
  },
  chip: {
    alignItems: 'center',
    backgroundColor: fallbackColors.background,
    borderRadius: 16,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  chipOutlined: {
    backgroundColor: 'transparent',
    borderColor: fallbackColors.border,
    borderWidth: 1
  },
  chipText: {
    color: fallbackColors.text
  },
  fab: {
    alignItems: 'center',
    backgroundColor: fallbackColors.tint,
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56
  },
  fabSmall: {
    borderRadius: 20,
    height: 40,
    width: 40
  },
  fabText: {
    color: '#ffffff',
    fontSize: 20
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  iconText: {
    color: fallbackColors.text,
    fontSize: 16
  },
  segment: {
    alignItems: 'center',
    borderColor: fallbackColors.border,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 8
  },
  segmentSelected: {
    backgroundColor: fallbackColors.tint
  },
  segmentText: {
    color: fallbackColors.text
  },
  segmentTextSelected: {
    color: '#ffffff'
  },
  segmentedRow: {
    flexDirection: 'row'
  }
})
