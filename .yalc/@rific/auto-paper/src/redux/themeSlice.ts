import { ThemeAppearance } from '../useComputedTheme'
import type { ColorHarmony, TriadicPalette } from '../utils/getTriadicPalette'

export type { ThemeAppearance }

export type ThemeState = {
  appearance: ThemeAppearance
  blur: boolean
  color: string | TriadicPalette
  harmony: ColorHarmony
}

const defaultInitialState: ThemeState = {
  appearance: 'system',
  blur: true,
  color: '#6750a4',
  harmony: 'split-complementary'
}

// Hand-rolled slice (no @reduxjs/toolkit dependency). Action types and creator
// behavior match the previous createSlice implementation exactly, so this works
// with RTK stores, vanilla Redux, or any reducer-based state container.
type PayloadAction<P> = { payload: P; type: string }

const createAction = <P>(type: string) => {
  const actionCreator = (payload: P): PayloadAction<P> => ({ payload, type })
  actionCreator.type = type
  actionCreator.match = (action: { type: string }): action is PayloadAction<P> => action.type === type
  return actionCreator
}

const initialize = createAction<Partial<ThemeState>>('theme/initialize')
const setAppearance = createAction<ThemeAppearance>('theme/setAppearance')
const setBlur = createAction<boolean>('theme/setBlur')
const setColor = createAction<string | TriadicPalette>('theme/setColor')
const setHarmony = createAction<ColorHarmony>('theme/setHarmony')

export const themeActions = { initialize, setAppearance, setBlur, setColor, setHarmony }

const reduce = (state: ThemeState, action: { type: string }): ThemeState => {
  if (initialize.match(action)) return { ...state, ...action.payload }
  if (setAppearance.match(action)) return { ...state, appearance: action.payload }
  if (setBlur.match(action)) return { ...state, blur: action.payload }
  if (setColor.match(action)) return { ...state, color: action.payload }
  if (setHarmony.match(action)) return { ...state, harmony: action.payload }
  return state
}

export function createThemeReducer(initialState?: Partial<ThemeState>) {
  const initial = { ...defaultInitialState, ...initialState }
  return (state: ThemeState = initial, action: { type: string }): ThemeState => reduce(state, action)
}

export const themeReducer = (state: ThemeState = defaultInitialState, action: { type: string }): ThemeState => reduce(state, action)

export const selectThemeAppearance = (state: ThemeState) => state.appearance
export const selectThemeBlur = (state: ThemeState) => state.blur
export const selectThemeColor = (state: ThemeState) => state.color
export const selectThemeHarmony = (state: ThemeState) => state.harmony
