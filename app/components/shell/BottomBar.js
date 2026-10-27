'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/app/components/Icon';
import { navFor, isItemActive } from './nav';

export function BottomBar({ user, needsMe = 0, onOpenDrawer, navPending, onNavigate }) {
  const pathname = usePathname();
  const groups = navFor(user, needsMe);
  const primaryItems = groups.flatMap(g => g.items).filter(i => i.primary);

  return (
    <nav className="mobile-bottom-bar" aria-label="Quick navigation">
      {primaryItems.map((item) => {
        const active = isItemActive(navPending || pathname, item.href);
        return (
          <Link
            key={item.id}
            href={item.href}
            className={`mobile-bottom-item ${active ? 'active' : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => onNavigate?.(item.href)}
          >
            <span style={{ position: 'relative', display: 'flex' }}>
              <Icon name={item.icon} size={18} />
              {item.badge > 0 && <span className="mobile-bottom-badge">{item.badge}</span>}
            </span>
            <span>{item.label.split(' ')[0]}</span>
          </Link>
        );
      })}
      <button
        type="button"
        className="mobile-bottom-item"
        onClick={onOpenDrawer}
        aria-label="Open full menu"
      >
        <span style={{ display: 'flex' }}>
          <Icon name="more-horizontal" size={18} />
        </span>
        <span>More</span>
      </button>
    </nav>
  );
}

export default BottomBar;
