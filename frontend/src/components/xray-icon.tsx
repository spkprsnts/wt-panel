import * as React from "react"

interface XrayIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number
}

/** Xray-core's own four-blade pinwheel mark (not a Material Symbols glyph), same path data as WireTurn's ic_xray_24px.xml. */
function XrayIcon({ size = 24, ...props }: XrayIconProps) {
  return (
    <svg
      viewBox="0 0 1000 1000"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M 530,530 L 900,530 L 650,650 L 530,1000 Z" />
      <path d="M 470,530 L 470,900 L 350,650 L 0,530 Z" />
      <path d="M 530,470 L 530,100 L 650,350 L 1000,470 Z" />
      <path d="M 470,470 L 100,470 L 350,350 L 470,0 Z" />
    </svg>
  )
}

export { XrayIcon }
