import { Image, Pressable, Text, View } from 'react-native'

import { type CardActionsProps, type CardContentProps, type CardCoverProps, type CardProps, type CardTitleProps, useHapticPressPaper } from '../../PaperContext'
import { useHapticHandlers } from '../../useHapticHandlers'
import { fallbackStyles } from './fallbackStyles'

export type { CardProps }

const CardComponent = (props: CardProps) => {
  const paper = useHapticPressPaper()
  const { children, mode, ...wired } = useHapticHandlers(props)

  if (paper)
    return (
      <paper.Card {...wired} mode={mode}>
        {children}
      </paper.Card>
    )

  // No `paper` injected: plain-RN fallback, not a Material Design reproduction. Only wraps
  // in a Pressable when the card is actually interactive, same as every other wrapper here.
  if (!(wired.onPress || wired.onLongPress)) return <View style={fallbackStyles.card}>{children}</View>
  return (
    <Pressable onLongPress={wired.onLongPress} onPress={wired.onPress} onPressIn={wired.onPressIn} style={fallbackStyles.card}>
      {children}
    </Pressable>
  )
}

const CardContent = ({ children, ...rest }: CardContentProps) => {
  const paper = useHapticPressPaper()
  if (paper) return <paper.Card.Content {...rest}>{children}</paper.Card.Content>
  return <View style={fallbackStyles.cardContent}>{children}</View>
}
CardContent.displayName = 'Card.Content'

const CardTitle = (props: CardTitleProps) => {
  const paper = useHapticPressPaper()
  if (paper) return <paper.Card.Title {...props} />
  const { subtitle, title } = props
  return (
    <View style={fallbackStyles.cardContent}>
      {title != null ? <Text style={fallbackStyles.cardTitleText}>{title}</Text> : null}
      {subtitle != null ? <Text style={fallbackStyles.chipText}>{subtitle}</Text> : null}
    </View>
  )
}
CardTitle.displayName = 'Card.Title'

const CardActions = ({ children, ...rest }: CardActionsProps) => {
  const paper = useHapticPressPaper()
  if (paper) return <paper.Card.Actions {...rest}>{children}</paper.Card.Actions>
  return <View style={fallbackStyles.cardActions}>{children}</View>
}
CardActions.displayName = 'Card.Actions'

const CardCover = (props: CardCoverProps) => {
  const paper = useHapticPressPaper()
  if (paper) return <paper.Card.Cover {...props} />
  return <Image source={props.source} style={fallbackStyles.cardCover} />
}
CardCover.displayName = 'Card.Cover'

export const Card = Object.assign(CardComponent, {
  Actions: CardActions,
  Content: CardContent,
  Cover: CardCover,
  Title: CardTitle
})
