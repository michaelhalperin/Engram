import type { SVGProps } from 'react';

type MarkProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

/** Engram mark — vault card with memory layers and imprint groove. */
export function EngramMark({ size = 20, className, ...props }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
      {...props}
    >
      <rect x="4" y="4" width="24" height="24" rx="4" stroke="currentColor" strokeWidth="2" />
      <rect className="engram-mark-accent" x="9" y="8" width="3" height="16" rx="0.75" />
      <path className="engram-mark-accent" d="M12 15.25 14.25 16.5 12 17.75Z" />
      <line x1="15.5" y1="11" x2="23.5" y2="11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <line x1="15.5" y1="16" x2="23.5" y2="16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <line x1="15.5" y1="21" x2="23.5" y2="21" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

type LogoProps = {
  className?: string;
  markClassName?: string;
  textClassName?: string;
  markSize?: number;
  wordmark?: boolean;
};

export function EngramLogo({
  className,
  markClassName,
  textClassName,
  markSize = 20,
  wordmark = true,
}: LogoProps) {
  return (
    <span className={className}>
      <EngramMark size={markSize} className={markClassName} />
      {wordmark && <span className={textClassName}>engram</span>}
    </span>
  );
}
