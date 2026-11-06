import { render } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import { MdIcon } from '@/components/MdIcon'

type Rendered = { props: { style?: unknown }; children: (Rendered | string)[] | null }

function styles(node: Rendered | string | null): object[] {
  if (!node || typeof node === 'string') return []
  return [StyleSheet.flatten(node.props.style as never) ?? {}, ...(node.children ?? []).flatMap(styles)]
}

describe('MdIcon', () => {
  // A FAB's icon is centered by layout alone (see fabRingStyle); an offset here would push every icon
  // in the app off center.
  it('centers the glyph in a box of its own size with no offset', async () => {
    const screen = await render(<MdIcon name='cog' color='#000000' size={24} />)
    const [container, ...inner] = styles(screen.toJSON() as Rendered)
    expect(container).toMatchObject({ alignItems: 'center', height: 24, justifyContent: 'center', width: 24 })
    for (const style of [container, ...inner]) {
      expect(style).not.toHaveProperty('transform')
    }
  })
})
