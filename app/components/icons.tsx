import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function IconBase({ title, children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export function WindowIcon(props: IconProps) {
  return <IconBase {...props}><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M12 3v18M4 12h16" /></IconBase>;
}

export function HomeIcon(props: IconProps) {
  return <IconBase {...props}><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></IconBase>;
}

export function CartIcon(props: IconProps) {
  return <IconBase {...props}><path d="M3 4h2l2 11h10l3-8H6" /><circle cx="9" cy="19" r="1" /><circle cx="17" cy="19" r="1" /></IconBase>;
}

export function PackageIcon(props: IconProps) {
  return <IconBase {...props}><path d="m4 7 8-4 8 4-8 4-8-4Z" /><path d="M4 7v10l8 4 8-4V7M12 11v10" /></IconBase>;
}

export function TruckIcon(props: IconProps) {
  return <IconBase {...props}><path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z" /><circle cx="7" cy="19" r="2" /><circle cx="18" cy="19" r="2" /></IconBase>;
}

export function WarehouseIcon(props: IconProps) {
  return <IconBase {...props}><path d="M3 9 12 3l9 6v12H3V9Z" /><path d="M7 21v-7h10v7M7 10h2M11 10h2M15 10h2" /></IconBase>;
}

export function SearchIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></IconBase>;
}

export function BellIcon(props: IconProps) {
  return <IconBase {...props}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></IconBase>;
}

export function CheckIcon(props: IconProps) {
  return <IconBase {...props}><path d="m5 12 4 4L19 6" /></IconBase>;
}

export function AlertIcon(props: IconProps) {
  return <IconBase {...props}><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 9v4M12 17h.01" /></IconBase>;
}

export function InfoIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></IconBase>;
}

export function ClockIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></IconBase>;
}

export function ChevronRightIcon(props: IconProps) {
  return <IconBase {...props}><path d="m9 18 6-6-6-6" /></IconBase>;
}

export function ChevronDownIcon(props: IconProps) {
  return <IconBase {...props}><path d="m6 9 6 6 6-6" /></IconBase>;
}

export function ArrowUpIcon(props: IconProps) {
  return <IconBase {...props}><path d="m12 19V5M6 11l6-6 6 6" /></IconBase>;
}

export function ArrowDownIcon(props: IconProps) {
  return <IconBase {...props}><path d="M12 5v14M18 13l-6 6-6-6" /></IconBase>;
}

export function ScanIcon(props: IconProps) {
  return <IconBase {...props}><path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4M7 12h10" /></IconBase>;
}

export function UndoIcon(props: IconProps) {
  return <IconBase {...props}><path d="M9 7 4 12l5 5M5 12h9a6 6 0 1 1 0 12" /></IconBase>;
}

export function CloseIcon(props: IconProps) {
  return <IconBase {...props}><path d="m6 6 12 12M18 6 6 18" /></IconBase>;
}

export function MoreIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></IconBase>;
}
