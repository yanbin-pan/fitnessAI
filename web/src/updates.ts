// An app on the home screen is resumed, not reloaded: left alone it would keep running the version it started with,
// for days, and a new release would only arrive two cold starts later. So it looks for a new version each time it
// is shown or hidden, and switches to one while it is out of sight, or the moment it comes back, never under
// someone's fingers.

/** Starts watching; returns what stops it. */
export function keepCurrent(): () => void {
  if (!("serviceWorker" in navigator)) return () => {};
  const workers = navigator.serviceWorker;
  // The very first install takes over a page that had no worker: that is the same version, not a new one.
  let controlled = workers.controller !== null;
  let newer = false;

  const onControllerChange = () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    newer = true;
    if (document.visibilityState === "hidden") window.location.reload();
  };

  const onVisibilityChange = () => {
    if (newer && document.visibilityState === "visible") {
      window.location.reload();
      return;
    }
    workers
      .getRegistration()
      .then((registration) => registration?.update())
      .catch(() => {
        // Offline, or the server is restarting: the next show or hide looks again.
      });
  };

  workers.addEventListener("controllerchange", onControllerChange);
  document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    workers.removeEventListener("controllerchange", onControllerChange);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
