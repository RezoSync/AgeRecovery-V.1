import type { ReactNode } from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

export type IconName =
  | "home" | "calendar" | "chat" | "camera" | "user" | "alert" | "sun" | "hand"
  | "moon" | "check" | "arrow" | "shield" | "bell" | "mail" | "lock" | "phone"
  | "send" | "map" | "clock" | "chevron" | "info" | "spark" | "heart" | "globe"
  | "watch" | "trash" | "logout" | "refresh";

const paths: Record<IconName, ReactNode> = {
  home: <><Path d="m3 10 9-7 9 7" /><Path d="M5 9v11h14V9M9 20v-7h6v7" /></>,
  calendar: <><Rect x="3" y="5" width="18" height="16" rx="2" /><Path d="M16 3v4M8 3v4M3 10h18" /></>,
  chat: <><Path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" /><Path d="M8 10h8M8 14h5" /></>,
  camera: <><Path d="M14.5 5 13 3h-2L9.5 5H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z" /><Circle cx="12" cy="12.5" r="4" /></>,
  user: <><Circle cx="12" cy="8" r="4" /><Path d="M4 21a8 8 0 0 1 16 0" /></>,
  alert: <><Path d="M10.3 3.6 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 3.6a2 2 0 0 0-3.4 0Z" /><Path d="M12 9v4M12 17h.01" /></>,
  sun: <><Circle cx="12" cy="12" r="4" /><Path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  hand: <Path d="M6 12V7a2 2 0 0 1 4 0v4-6a2 2 0 0 1 4 0v6-4a2 2 0 0 1 4 0v7a8 8 0 0 1-8 8h-1a6 6 0 0 1-5-3l-2-3a2 2 0 0 1 3-3Z" />,
  moon: <Path d="M20 15.2A9 9 0 0 1 8.8 4 9 9 0 1 0 20 15.2Z" />,
  check: <Path d="m5 12 4 4L19 6" />,
  arrow: <><Path d="M5 12h14M14 7l5 5-5 5" /></>,
  shield: <><Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><Path d="m9 12 2 2 4-5" /></>,
  bell: <Path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />,
  mail: <><Rect x="3" y="5" width="18" height="14" rx="2" /><Path d="m3 7 9 6 9-6" /></>,
  lock: <><Rect x="4" y="10" width="16" height="11" rx="2" /><Path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  phone: <Path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2.1Z" />,
  send: <><Path d="m22 2-7 20-4-9-9-4Z" /><Path d="M22 2 11 13" /></>,
  map: <><Path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><Circle cx="12" cy="10" r="2.5" /></>,
  clock: <><Circle cx="12" cy="12" r="9" /><Path d="M12 7v5l3 2" /></>,
  chevron: <Path d="m9 18 6-6-6-6" />,
  info: <><Circle cx="12" cy="12" r="9" /><Path d="M12 11v5M12 8h.01" /></>,
  spark: <Path d="m12 3 1.3 4.7L18 9l-4.7 1.3L12 15l-1.3-4.7L6 9l4.7-1.3Z" />,
  heart: <Path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />,
  globe: <><Circle cx="12" cy="12" r="9" /><Path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  watch: <><Rect x="7" y="6" width="10" height="12" rx="3" /><Path d="m9 6 1-4h4l1 4M9 18l1 4h4l1-4" /></>,
  trash: <Path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7" />,
  logout: <Path d="M10 17l5-5-5-5M15 12H3M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />,
  refresh: <><Path d="M20 7h-5V2" /><Path d="M20 7a9 9 0 1 0 1 8" /></>,
};

export function Icon({ name, size = 20, color = "currentColor" }: { name: IconName; size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </Svg>
  );
}
