import React from 'react'
import { View, Text, ActivityIndicator } from 'react-native'
import { colors, fonts } from '../../theme'

export interface KinoBannersProps {
  isCranking: boolean
  crankCount: number
  captureFps: number
  kinoDevelopingCount: number | null
}

export const KinoBanners: React.FC<KinoBannersProps> = ({
  isCranking,
  crankCount,
  captureFps,
  kinoDevelopingCount,
}) => {
  return (
    <>
      {/* LomoKino Cranking Banner */}
      {isCranking && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: 155,
            left: 0,
            right: 0,
            alignItems: 'center',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              backgroundColor: 'rgba(10, 10, 15, 0.92)',
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: '#f39c12',
            }}
          >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#e74c3c' }} />
            <Text style={{ fontFamily: fonts.monoBold, fontSize: 12, color: '#fff' }}>
              ⚡ BURST SHOOTING ({captureFps} FPS) · {crankCount} FRAMES (
              {(crankCount / captureFps).toFixed(1)}s)
            </Text>
          </View>
        </View>
      )}

      {/* Burst Developing Banner */}
      {kinoDevelopingCount !== null && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: 155,
            left: 0,
            right: 0,
            alignItems: 'center',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              backgroundColor: 'rgba(10, 10, 15, 0.94)',
              paddingHorizontal: 18,
              paddingVertical: 9,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: colors.accent,
            }}
          >
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={{ fontFamily: fonts.monoBold, fontSize: 11, color: colors.text }}>
              DEVELOPING {kinoDevelopingCount} BURST FRAMES...
            </Text>
          </View>
        </View>
      )}
    </>
  )
}
