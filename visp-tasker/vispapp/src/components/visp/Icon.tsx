/**
 * VISP — Icon wrapper around lucide-react-native.
 *
 * Centralised so we can swap libs once if needed. The mockup uses ~30 line
 * icons with stroke 1.6 default (1.9 when active). Importing icons by name
 * keeps the bundle tree-shakeable.
 */

import React, { ComponentType } from 'react';
import {
  Home,
  Briefcase,
  MessageSquare,
  DollarSign,
  User,
  MapPin,
  Bell,
  Settings,
  SlidersHorizontal,
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  Search,
  Brush,
  Truck,
  Wrench,
  Package,
  Zap,
  Dog,
  Leaf,
  Sparkles,
  BookOpen,
  Calendar,
  CreditCard,
  Shield,
  HelpCircle,
  LogOut,
  Lock,
  ArrowLeftRight,
  Eye,
  EyeOff,
  Info,
  Check,
  Star,
  Grid3x3,
  Building2,
  Phone,
  Mail,
  MoreHorizontal,
  ChevronDown,
  TrendingUp,
} from 'lucide-react-native';

export type VispIconName =
  | 'home'
  | 'briefcase'
  | 'msg'
  | 'money'
  | 'user'
  | 'pin'
  | 'bell'
  | 'settings'
  | 'sliders'
  | 'plus'
  | 'x'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'search'
  | 'broom'
  | 'truck'
  | 'wrench'
  | 'package'
  | 'bolt'
  | 'paw'
  | 'leaf'
  | 'spark'
  | 'book'
  | 'cal'
  | 'card'
  | 'shield'
  | 'help'
  | 'logout'
  | 'lock'
  | 'swap'
  | 'eye'
  | 'eye-off'
  | 'info'
  | 'check'
  | 'star'
  | 'grid'
  | 'bank'
  | 'phone'
  | 'mail'
  | 'dots'
  | 'trending';

const MAP: Record<VispIconName, ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  home: Home,
  briefcase: Briefcase,
  msg: MessageSquare,
  money: DollarSign,
  user: User,
  pin: MapPin,
  bell: Bell,
  settings: Settings,
  sliders: SlidersHorizontal,
  plus: Plus,
  x: X,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  search: Search,
  broom: Brush,
  truck: Truck,
  wrench: Wrench,
  package: Package,
  bolt: Zap,
  paw: Dog,
  leaf: Leaf,
  spark: Sparkles,
  book: BookOpen,
  cal: Calendar,
  card: CreditCard,
  shield: Shield,
  help: HelpCircle,
  logout: LogOut,
  lock: Lock,
  swap: ArrowLeftRight,
  eye: Eye,
  'eye-off': EyeOff,
  info: Info,
  check: Check,
  star: Star,
  grid: Grid3x3,
  bank: Building2,
  phone: Phone,
  mail: Mail,
  dots: MoreHorizontal,
  trending: TrendingUp,
};

interface IconProps {
  name: VispIconName;
  size?: number;
  color?: string;
  active?: boolean;
}

export function Icon({ name, size = 20, color = '#FFFFFF', active = false }: IconProps): React.JSX.Element | null {
  const Cmp = MAP[name];
  if (!Cmp) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(`[VispIcon] Unknown icon "${name}"`);
    }
    return null;
  }
  return <Cmp size={size} color={color} strokeWidth={active ? 1.9 : 1.6} />;
}
