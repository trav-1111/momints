import React from 'react'
import { View, Text } from 'react-native'
import { colors, fonts } from '../../theme'

export interface LongExposureBannerProps {
  isCapturing: boolean
  shutterMode: string
  manualShutterNs: number | null | undefined
}

export const LongExposureBanner: React.FC<LongExposureBannerProps> = ({
  isCapturing,
  shutterMode,
  manualShutterNs,
}) => {
  if (
    !isCapturing ||
    shutterMode !== 'manual' ||
    manualShutterNs == null ||
    manualShutterNs < 500_000_000
  ) {
    return null
  }

  const durationSec = (manualShutterNs / 1e9).toFixed(1)

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 8,
        left: 0,
        right: 0,
        alignItems: 'center',
      }}
    >
      <View
        style={{
          backgroundColor: 'rgba(15,15,20,0.88)',
          paddingHorizontal: 12,
          paddingVertical: 5,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.accentSoft,
        }}
      >
        <Text
          style={{
            fontFamily: fonts.monoBold,
            fontSize: 11,
            color: colors.accentSoft,
            letterSpacing: 0.8,
          }}
        >
          {`HOLD STILL · EXPOSING ${durationSec}s`}
        </Text>
      </View>
    </View>
  )
}
