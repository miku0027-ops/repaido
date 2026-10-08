import type {HTMLAttributes, ReactNode} from 'react';

/** Shared shell for the identity, image and summary layouts in the brand system.
 * Keep content and actions in the module; this adds no extra DOM wrapper. */
export function Card({as:Tag='article',className='',children,...props}:HTMLAttributes<HTMLElement>&{as?:'article'|'section'|'div';children:ReactNode}){
  return <Tag {...props} className={`ui-card ${className}`.trim()}>{children}</Tag>;
}
