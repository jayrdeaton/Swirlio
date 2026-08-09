import React from 'react'
import { StyleSheet } from 'react-native'
import { Menu as PaperMenu, type MenuItemProps, type MenuProps as PaperMenuProps } from 'react-native-paper'

import { useBlur } from '../BlurContext'
import { BlurView } from './BlurView'

export type MenuProps = PaperMenuProps & {
  blur?: boolean
}

const MenuComponent = ({ blur: blurProp, children, ...props }: MenuProps) => {
  const blur = useBlur(blurProp)
  return (
    <PaperMenu {...props} contentStyle={[styles.content, props.contentStyle]}>
      <BlurView blur={blur}>{children}</BlurView>
    </PaperMenu>
  )
}

export const Menu = Object.assign(MenuComponent, {
  Item: PaperMenu.Item as React.FC<MenuItemProps>
})

const styles = StyleSheet.create({
  content: { backgroundColor: 'transparent', paddingVertical: 0 }
})
