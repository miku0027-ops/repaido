import repaidoLogoUrl from '../assets/repaido-logo-transparent.png';

interface RepaidoBrandProps {
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'hero';
  className?: string;
  onClick?: () => void;
}

/**
 * Official Repaido Brand Logo Component
 * - Blue house with white wrench cutout
 * - Dark navy bold 'repaido'
 * - Red dot on 'i' wrench stem
 * - Precision gear on 'o'
 * - 'Home services' subtitle
 * - Vite content-hashed URL to guarantee immediate browser updates
 */
export default function RepaidoBrand({
  size = 'md',
  className = '',
  onClick
}: RepaidoBrandProps) {
  // Height in pixels for reliable rendering across all screens & viewports
  const pixelHeights = {
    sm: 32,
    md: 42,
    lg: 54,
    xl: 68,
    hero: 88
  };

  const height = pixelHeights[size];

  return (
    <div
      className={`repaido-brand-container inline-flex items-center select-none ${onClick ? 'cursor-pointer' : ''} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <img
        src={repaidoLogoUrl}
        width={809}
        height={220}
        alt="Repaido — Home services"
        style={{ height: `${height}px`, width: 'auto', maxHeight: `${height}px` }}
        className="w-auto object-contain transition-transform duration-200 hover:scale-[1.02] drop-shadow-sm"
        loading="eager"
        decoding="sync"
        onError={(e) => {
          const target = e.currentTarget;
          const fallback = '/brand/repaido-logo-transparent.png?v=20260922';
          if (!target.src.includes('v=20260922')) {
            target.src = fallback;
          }
        }}
      />
    </div>
  );
}
