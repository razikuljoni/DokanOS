import React from 'react';
import { Link } from 'react-router';
import { Bell } from 'lucide-react';

export function NotificationBell({ unreadCount }: { unreadCount: number }): React.ReactElement {
  return (
    <Link
      to="/app/alerts"
      className="relative p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
      title="Notifications & Low-Stock Alerts"
    >
      <Bell className="h-4 w-4" />
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-warning text-white text-[10px] font-mono tabular-nums flex items-center justify-center">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
