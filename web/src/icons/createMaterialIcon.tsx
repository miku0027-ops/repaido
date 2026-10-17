import { forwardRef, useId, type CSSProperties, type SVGProps } from 'react'
import '../icon-system.css'

/** Material Symbols use filled outline geometry; stroke props are retained only for API compatibility. */
export interface MaterialIconProps extends SVGProps<SVGSVGElement> {
  size?: number | string
  /** Official filled variant for favorite/bookmark/star; preserves selected-action state. */
  filled?: boolean
  absoluteStrokeWidth?: boolean
  title?: string
}

/** Compatibility types let existing feature components share the new icon family. */
export type LucideProps = MaterialIconProps
export type LucideIcon = ReturnType<typeof createMaterialIcon>
export type MaterialIcon = LucideIcon

type PathDefinition = { d: string; fillRule?: 'evenodd' | 'nonzero'; clipRule?: 'evenodd' | 'nonzero' }
type IconStyle = CSSProperties & { '--icon-size': string }

function utilitySize(className = ''): number | undefined {
  // Preserve existing unprefixed Tailwind dimensions without coupling icons to the utility stylesheet.
  const dimensions = className.split(/\s+/).flatMap(token => {
    const match = /^(?:size|w|h)-(\d+(?:\.\d+)?)$/.exec(token)
    return match ? [Number(match[1]) * 4] : []
  })
  return dimensions.length && dimensions.every(value => value === dimensions[0]) ? dimensions[0] : undefined
}

function cssSize(value: string | number): string {
  return typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(value) ? `${value}px` : value
}

/** @internal Generated named exports keep each symbol independently removable by the bundler. */
export function createMaterialIcon(displayName: string, symbol: string, paths: readonly PathDefinition[], viewBox = '0 -960 960 960', filledPaths?: readonly PathDefinition[]) {
  const Icon = forwardRef<SVGSVGElement, MaterialIconProps>(function MaterialSymbol({
    size, width, height, color = 'currentColor', className = '', title, style, children,
    stroke: _stroke, strokeWidth: _strokeWidth, absoluteStrokeWidth: _absoluteStrokeWidth,
    fill: legacyFill, filled, viewBox: _viewBox, focusable = false, role,
    'aria-hidden': ariaHidden, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy,
    ...props
  }, ref) {
    const titleId = useId()
    const selected = (filled ?? legacyFill === 'currentColor') && Boolean(filledPaths)
    const renderedPaths = selected && filledPaths ? filledPaths : paths
    const resolvedSize = size ?? width ?? height ?? utilitySize(className) ?? 24
    const hasLabel = Boolean(title || ariaLabel || ariaLabelledBy)
    const hidden = ariaHidden ?? !hasLabel
    const labelledBy = [ariaLabelledBy, title ? titleId : undefined].filter(Boolean).join(' ') || undefined
    const iconStyle: IconStyle = {
      ...style,
      '--icon-size': cssSize(resolvedSize),
      fill: 'currentColor',
      stroke: 'none',
      strokeWidth: 0,
    }
    return (
      <svg {...props} ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={viewBox}
        width={resolvedSize} height={resolvedSize} color={color} fill="currentColor" stroke="none" strokeWidth={0}
        className={`repaido-icon material-symbols-rounded${className ? ` ${className}` : ''}`}
        data-icon={symbol} data-icon-size={resolvedSize} data-icon-fill={selected ? 1 : 0} style={iconStyle} focusable={focusable}
        role={role ?? (hasLabel && hidden !== true && hidden !== 'true' ? 'img' : undefined)}
        aria-hidden={hidden} aria-label={ariaLabel} aria-labelledby={labelledBy}>
        {title ? <title id={titleId}>{title}</title> : null}
        {renderedPaths.map((path, index) => <path key={index} {...path} fill="currentColor" stroke="none" style={{ fill: 'currentColor', stroke: 'none', strokeWidth: 0 }} />)}
        {children}
      </svg>
    )
  })
  Icon.displayName = displayName
  return Icon
}
