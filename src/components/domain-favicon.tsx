import { Globe } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

const ICON_CLASS = 'size-4 shrink-0 rounded-[3px]'
const faviconAssetsUrl = import.meta.env.VITE_FAVICON_ASSETS_URL?.replace(/\/+$/, '')

// Remote favicon lookup is opt-in. An isolated/self-hosted build makes no favicon request unless an
// operator explicitly configures a trusted asset origin. Decorative, so the image is aria-hidden.
export const DomainFavicon = ({ domain }: { domain: string }) => {
  const [failed, setFailed] = useState(false)

  if (!faviconAssetsUrl || failed) {
    return <Globe aria-hidden className={cn(ICON_CLASS, 'p-px text-muted-foreground/45')} />
  }

  return (
    <img
      src={`${faviconAssetsUrl}/${encodeURIComponent(domain)}`}
      alt=""
      aria-hidden
      draggable={false}
      loading="lazy"
      referrerPolicy="no-referrer"
      width={16}
      height={16}
      onError={() => setFailed(true)}
      // Muted to match the other row glyphs; the fallback globe is already muted by its own color.
      className={cn(ICON_CLASS, 'object-contain saturate-[0.5] opacity-95')}
    />
  )
}
