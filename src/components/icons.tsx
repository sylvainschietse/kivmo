import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({ width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...p });

export const IconHome = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /></svg>);
export const IconPump = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M4 20V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15" /><path d="M3 20h12" /><path d="M7 8h4" /><path d="M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3" /></svg>);
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>);
export const IconTarget = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" /></svg>);
export const IconCar = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M5 16V11l2-5h10l2 5v5" /><path d="M3 16h18v3H3z" /><circle cx="7.5" cy="13" r="1" /><circle cx="16.5" cy="13" r="1" /></svg>);
export const IconChart = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>);
export const IconHistory = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg>);
export const IconUser = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>);
export const IconBuilding = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M4 21V4h10v17" /><path d="M14 9h6v12" /><path d="M8 8h2M8 12h2M8 16h2" /><path d="M2 21h20" /></svg>);
export const IconHandshake = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="m11 17 2 2a1.4 1.4 0 0 0 2-2" /><path d="m14 14 2.5 2.5a1.4 1.4 0 0 0 2-2L15 11l-3 1-3-3 4-3 4 1 4 4" /><path d="M3 11l4-4 4 1" /><path d="m3 11 6 6a1.4 1.4 0 0 0 2-2" /></svg>);
export const IconBell = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>);
export const IconRoute = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h8a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h8" /></svg>);
export const IconCalc = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2" /></svg>);
export const IconShield = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /></svg>);
export const IconStar = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" /></svg>);
export const IconLocate = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>);
export const IconMic = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>);
export const IconCamera = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>);
export const IconMenu = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>);
