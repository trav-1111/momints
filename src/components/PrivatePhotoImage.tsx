import { useEffect, useState } from 'react'
import { Image, type ImageProps } from 'expo-image'
import { PixelRatio } from 'react-native'
import { ensureDisplayPreview } from '../services/displayPreview'
import { isRollVaultPhotoUri } from '../services/rollVault'
import { createRollVaultPreviewDataUri } from '../services/rollVaultPreview'

type PrivatePhotoImageProps = Omit<
  ImageProps,
  'source' | 'cachePolicy' | 'allowDownscaling' | 'enforceEarlyResizing' | 'recyclingKey' | 'transition'
> & {
  uri: string
  photoId: string
  /** Rendered width in React Native layout points. */
  displayWidth: number
  /** Rendered height in React Native layout points. */
  displayHeight: number
}

/**
 * Displays a user photograph without retaining another decoded or cached copy.
 *
 * The full-resolution file remains the authoritative mint input. The native
 * image loader decodes only as much detail as this view needs and releases the
 * prior drawable whenever a virtualized view is reused for another photo.
 */
export function PrivatePhotoImage({ uri, photoId, displayWidth, displayHeight, ...props }: PrivatePhotoImageProps) {
  const [displayUri, setDisplayUri] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    setDisplayUri(null)
    if (isRollVaultPhotoUri(uri)) {
      createRollVaultPreviewDataUri(uri, Math.max(displayWidth, displayHeight) * PixelRatio.get())
        .then((previewUri) => {
          if (mounted) setDisplayUri(previewUri)
        })
        .catch((error) => {
          console.error('Could not decrypt a bounded roll preview:', error)
        })
      return () => {
        mounted = false
      }
    }
    if (!uri.startsWith('file://')) {
      setDisplayUri(uri)
      return () => {
        mounted = false
      }
    }
    ensureDisplayPreview(uri)
      .then((previewUri) => {
        if (mounted) setDisplayUri(previewUri)
      })
      .catch((error) => {
        console.error('Could not create a bounded photo preview:', error)
        if (mounted) setDisplayUri(uri)
      })
    return () => {
      mounted = false
    }
  }, [displayHeight, displayWidth, uri])

  return (
    <Image
      {...props}
      source={
        displayUri
          ? {
              uri: displayUri,
              width: Math.ceil(displayWidth * PixelRatio.get()),
              height: Math.ceil(displayHeight * PixelRatio.get()),
            }
          : null
      }
      cachePolicy="none"
      allowDownscaling
      enforceEarlyResizing
      recyclingKey={photoId}
      transition={0}
    />
  )
}

/**
 * Releases decoded images no longer owned by a mounted view. `cachePolicy`
 * prevents application caching, but Android's decoder may still retain those
 * released bitmaps in its reusable pool until memory pressure occurs.
 */
export async function clearReleasedPrivatePhotoMemory(): Promise<void> {
  await Image.clearMemoryCache()
}
