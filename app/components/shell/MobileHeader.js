'use client';
import { Icon } from '@/app/components/Icon';
import { initials } from '@/app/components/ui';

export function MobileHeader({ title = 'NCC AMS', user, onOpenDrawer }) {
  return (
    <header className="mobile-header" aria-label="Mobile header">
      <button
        type="button"
        className="btn btn-icon btn-ghost btn-sm"
        onClick={onOpenDrawer}
        aria-label="Open navigation menu"
      >
        <Icon name="menu" size={20} />
      </button>
      <div className="mobile-header-title ellipsis">{title}</div>
      <button
        type="button"
        className="avatar"
        style={{ width: 32, height: 32, fontSize: 13, border: 0, cursor: 'pointer' }}
        onClick={onOpenDrawer}
        aria-label="Account menu"
      >
        {initials(user?.name)}
      </button>
    </header>
  );
}

export default MobileHeader;
