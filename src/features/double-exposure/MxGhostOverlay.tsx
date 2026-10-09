import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'

interface MxGhostOverlayProps {
  firstExposureUri: string | null
  aspectRatio?: number
}

/**
 * Renders an analog "ghost alignment" overlay over the camera viewfinder,
 * allowing the photographer to visually register the second exposure with the first.
 */
export const MxGhostOverlay: React.FC<MxGhostOverlayProps> = ({
  firstExposureUri,
  aspectRatio,
}) => {
  if (!firstExposureUri) return null

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image
        source={{ uri: firstExposureUri }}
        style={[
          styles.ghostImage,
          aspectRatio ? { aspectRatio } : StyleSheet.absoluteFillObject,
        ]}
        contentFit="cover"
        transition={200}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  ghostImage: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.42,
  },
})
