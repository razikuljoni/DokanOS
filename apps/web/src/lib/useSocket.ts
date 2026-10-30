import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { formatBDT } from '@/lib/utils';

let activeSocket: Socket | null = null;

export function useSocket(): void {
  const accessToken = useAuthStore((s) => s.accessToken);
  const tenantId = useAuthStore((s) => s.tenant?.id);
  const queryClient = useQueryClient();
  const addToast = useUiStore((s) => s.addToast);

  useEffect(() => {
    if (!accessToken || !tenantId) {
      if (activeSocket) {
        activeSocket.disconnect();
        activeSocket = null;
      }
      return;
    }

    const socket = io(window.location.origin, {
      auth: { token: accessToken },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    activeSocket = socket;

    socket.on('connect', () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard', tenantId] });
    });

    socket.on(
      'sale:created',
      (sale: { invoiceNo: string; total: number; customerName: string }) => {
        void queryClient.invalidateQueries({ queryKey: ['dashboard', tenantId] });
        void queryClient.invalidateQueries({ queryKey: ['sales', tenantId] });
        void queryClient.invalidateQueries({ queryKey: ['products', tenantId] });
        void queryClient.invalidateQueries({ queryKey: ['dues', tenantId] });

        addToast({
          title: `New Sale ${sale.invoiceNo}`,
          description: `${formatBDT(sale.total)} · ${sale.customerName}`,
          variant: 'success',
        });
      },
    );

    socket.on(
      'stock:low',
      (alert: { productId: string; name: string; stock: number }) => {
        void queryClient.invalidateQueries({ queryKey: ['products', tenantId] });
        void queryClient.invalidateQueries({ queryKey: ['dashboard', tenantId] });

        addToast({
          title: `Low Stock Alert: ${alert.name}`,
          description: `Only ${alert.stock} units left in stock.`,
          variant: 'warning',
        });
      },
    );

    socket.on('stock:updated', () => {
      void queryClient.invalidateQueries({ queryKey: ['products', tenantId] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', tenantId] });
    });

    socket.on('notification:new', (notif: { title: string; body: string }) => {
      void queryClient.invalidateQueries({ queryKey: ['notifications', tenantId] });
      addToast({
        title: notif.title,
        description: notif.body,
        variant: 'default',
      });
    });

    return () => {
      socket.disconnect();
      if (activeSocket === socket) {
        activeSocket = null;
      }
    };
  }, [accessToken, tenantId, queryClient, addToast]);
}
