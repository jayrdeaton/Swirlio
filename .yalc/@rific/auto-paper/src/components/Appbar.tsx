import { StatusBar } from 'react-native'
import { Appbar as PaperAppbar, type AppbarHeaderProps, useTheme } from 'react-native-paper'

import { usePaperDefaults } from '../PaperDefaultsContext'

function Header({ style, ...props }: AppbarHeaderProps) {
  const defaults = usePaperDefaults()
  const theme = useTheme()
  return (
    <>
      <StatusBar backgroundColor={theme.colors.surface} barStyle={theme.dark ? 'light-content' : 'dark-content'} />
      <PaperAppbar.Header {...defaults.AppbarHeader} {...props} style={style} />
    </>
  )
}

export const Appbar = {
  Header,
  Content: PaperAppbar.Content,
  Action: PaperAppbar.Action,
  BackAction: PaperAppbar.BackAction
}
