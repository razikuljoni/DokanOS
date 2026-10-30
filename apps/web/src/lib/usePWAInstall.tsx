import React, { useEffect, useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIOSDevice);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    install,
  };
}

export function PWAInstallButton(): React.ReactElement | null {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => void install()}
        title="Install DokanOS Counter App for offline POS access"
      >
        <Download className="h-3.5 w-3.5 text-primary" />
        <span className="hidden md:inline">Install App</span>
      </Button>
    );
  }

  if (isIOS) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowIOSGuide(true)}
          title="Install DokanOS on iPhone or iPad"
        >
          <Smartphone className="h-3.5 w-3.5 text-primary" />
          <span className="hidden md:inline">Install on iOS</span>
        </Button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-md border border-border bg-card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-bold text-foreground">
                  Install DokanOS on iOS
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ol className="list-decimal list-inside space-y-1.5 text-xs text-muted-foreground">
                <li>
                  Tap the <strong className="text-foreground">Share</strong> button in the Safari
                  toolbar.
                </li>
                <li>
                  Scroll down and tap <strong className="text-foreground">Add to Home Screen</strong>
                  .
                </li>
                <li>
                  Launch <strong className="text-foreground">DokanOS</strong> from your home screen
                  for standalone offline POS &amp; Baki access.
                </li>
              </ol>
              <Button size="sm" className="w-full" onClick={() => setShowIOSGuide(false)}>
                Got It
              </Button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
