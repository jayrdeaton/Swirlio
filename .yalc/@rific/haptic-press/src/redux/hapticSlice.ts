import { defaultHapticSettings, type HapticSettings } from '../HapticSettingsContext'

// Hand-rolled slice: no @reduxjs/toolkit dependency. Action types and creator
// behavior match the previous createSlice implementation exactly, so this works
// with RTK stores, vanilla Redux, or any reducer-based state container.
type PayloadAction<P> = { payload: P; type: string }

const createAction = <P>(type: string) => {
  const actionCreator = (payload: P): PayloadAction<P> => ({ payload, type })
  actionCreator.type = type
  actionCreator.match = (action: { type: string }): action is PayloadAction<P> => action.type === type
  return actionCreator
}

const initialize = createAction<HapticSettings>('haptic/initialize')
const setVibrate = createAction<boolean>('haptic/setVibrate')

export const hapticActions = { initialize, setVibrate }

export const hapticReducer = (state: HapticSettings = defaultHapticSettings, action: { type: string }): HapticSettings => {
  if (initialize.match(action)) return action.payload
  if (setVibrate.match(action)) return { ...state, vibrate: action.payload }
  return state
}
