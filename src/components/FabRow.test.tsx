import { render } from '@testing-library/react-native'
import React from 'react'
import { View } from 'react-native'

import { FabRow } from '@/components/FabRow'

test('renders every child unconditionally, regardless of how many or how they wrap', async () => {
  const screen = await render(
    <FabRow>
      <View testID='a' />
      <View testID='b' />
      <View testID='c' />
    </FabRow>
  )
  expect(screen.getByTestId('a')).toBeTruthy()
  expect(screen.getByTestId('b')).toBeTruthy()
  expect(screen.getByTestId('c')).toBeTruthy()
})
