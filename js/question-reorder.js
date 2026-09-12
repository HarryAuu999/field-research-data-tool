const LONG_PRESS_MS = 420;
const MOVE_TOLERANCE = 9;
const EDGE_ZONE = 86;
const MAX_SCROLL_SPEED = 13;
const DROP_DURATION_MS = 160;

export function bindLongPressReorder(container, { onReorder, onStatus } = {}) {
  if (!container) return () => {};
  let session = null;

  const removeDragVisuals = (current) => {
    if (!current) return;
    current.items?.forEach((item) => item.style.removeProperty("transform"));
    current.card?.classList.remove("reorder-placeholder");
    current.card?.removeAttribute("aria-grabbed");
    current.ghost?.remove();
    document.body.classList.remove("question-reordering");
  };

  const clearSession = (status = null) => {
    if (!session) return;
    const current = session;
    session = null;
    clearTimeout(current.timer);
    cancelAnimationFrame(current.scrollFrame);
    cancelAnimationFrame(current.moveFrame);
    try {
      if (current.pointerId !== null && current.card?.hasPointerCapture?.(current.pointerId)) current.card.releasePointerCapture(current.pointerId);
    } catch {
      // Synthetic pointer events used by automated tests do not own a real pointer.
    }
    removeDragVisuals(current);
    if (status) onStatus?.(status);
  };

  const moveGhost = () => {
    if (!session?.active || !session.ghost) return;
    session.moveFrame = 0;
    const deltaY = session.clientY - session.startY;
    session.ghost.style.transform = `translate3d(0, ${deltaY}px, 0) scale(1.025)`;
  };

  const scheduleGhostMove = () => {
    if (!session?.moveFrame) session.moveFrame = requestAnimationFrame(moveGhost);
  };

  const setTargetIndex = () => {
    if (!session?.active) return;
    const pointerDocumentY = session.clientY + window.scrollY;
    const otherItems = session.items.filter((item) => item !== session.card);
    const targetIndex = otherItems.findIndex((item) => pointerDocumentY < session.itemRects.get(item).centerY);
    const nextIndex = targetIndex < 0 ? otherItems.length : targetIndex;
    if (nextIndex === session.targetIndex) return;
    session.targetIndex = nextIndex;
    session.items.forEach((item, index) => {
      if (item === session.card) return;
      let offset = 0;
      if (nextIndex > session.originIndex && index > session.originIndex && index <= nextIndex) offset = -session.cardRect.height;
      if (nextIndex < session.originIndex && index >= nextIndex && index < session.originIndex) offset = session.cardRect.height;
      item.style.transform = offset ? `translate3d(0, ${offset}px, 0)` : "";
    });
  };

  const autoScroll = () => {
    if (!session?.active) return;
    const height = window.innerHeight;
    let delta = 0;
    if (session.clientY < EDGE_ZONE) delta = -MAX_SCROLL_SPEED * (1 - session.clientY / EDGE_ZONE);
    if (session.clientY > height - EDGE_ZONE) delta = MAX_SCROLL_SPEED * (1 - (height - session.clientY) / EDGE_ZONE);
    if (delta) {
      window.scrollBy(0, delta);
      setTargetIndex();
    }
    session.scrollFrame = requestAnimationFrame(autoScroll);
  };

  const activate = () => {
    if (!session) return;
    const cardRect = session.card.getBoundingClientRect();
    const items = [...container.querySelectorAll("[data-editor-field-id]")];
    const ghost = session.card.cloneNode(true);
    ghost.classList.remove("reorder-placeholder", "reorder-active");
    ghost.classList.add("reorder-drag-ghost");
    ghost.removeAttribute("data-action");
    ghost.removeAttribute("data-editor-field-id");
    ghost.setAttribute("aria-hidden", "true");
    ghost.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    Object.assign(ghost.style, {
      top: `${cardRect.top}px`,
      left: `${cardRect.left}px`,
      width: `${cardRect.width}px`,
      height: `${cardRect.height}px`
    });
    document.body.append(ghost);
    session.active = true;
    session.items = items;
    session.originIndex = items.indexOf(session.card);
    session.targetIndex = session.originIndex;
    session.cardRect = cardRect;
    session.itemRects = new Map(items.map((item) => {
      const rect = item.getBoundingClientRect();
      return [item, { centerY: rect.top + window.scrollY + rect.height / 2 }];
    }));
    session.ghost = ghost;
    session.card.classList.add("reorder-placeholder");
    session.card.setAttribute("aria-grabbed", "true");
    document.body.classList.add("question-reordering");
    try {
      if (session.pointerId !== null) session.card.setPointerCapture?.(session.pointerId);
    } catch {
      // Synthetic pointer events used by automated tests do not own a real pointer.
    }
    scheduleGhostMove();
    onStatus?.("active");
    session.scrollFrame = requestAnimationFrame(autoScroll);
  };

  const startSession = ({ target, clientX, clientY, pointerId = null, touchIdentifier = null }) => {
    const card = target.closest("[data-editor-field-id]");
    if (!card || target.closest("input, textarea, select, label, [data-no-reorder]")) return;
    clearSession();
    session = {
      pointerId,
      touchIdentifier,
      startX: clientX,
      startY: clientY,
      clientX,
      clientY,
      card,
      active: false,
      moved: false,
      scrollFrame: 0,
      moveFrame: 0,
      timer: setTimeout(activate, LONG_PRESS_MS)
    };
  };

  const updateSession = (clientX, clientY, event) => {
    if (!session) return;
    session.clientX = clientX;
    session.clientY = clientY;
    const distance = Math.hypot(clientX - session.startX, clientY - session.startY);
    if (!session.active && distance > MOVE_TOLERANCE) {
      clearSession();
      return;
    }
    if (!session.active) return;
    event.preventDefault();
    session.moved = true;
    scheduleGhostMove();
    setTargetIndex();
  };

  const finishSession = () => {
    if (!session) return;
    if (!session.active) {
      clearSession();
      return;
    }
    const current = session;
    session = null;
    clearTimeout(current.timer);
    cancelAnimationFrame(current.scrollFrame);
    cancelAnimationFrame(current.moveFrame);
    const moved = current.moved && current.targetIndex !== current.originIndex;
    const otherItems = current.items.filter((item) => item !== current.card);
    if (current.targetIndex >= otherItems.length) container.append(current.card);
    else container.insertBefore(current.card, otherItems[current.targetIndex]);
    current.items.forEach((item) => item.style.removeProperty("transform"));
    const finalRect = current.card.getBoundingClientRect();
    const finalOffsetY = finalRect.top - current.cardRect.top;
    const currentOffsetY = current.clientY - current.startY;
    current.card.dataset.suppressClick = "true";
    const complete = () => {
      removeDragVisuals(current);
      setTimeout(() => delete current.card.dataset.suppressClick, 0);
      if (moved) {
        const ids = [...container.querySelectorAll("[data-editor-field-id]")].map((item) => item.dataset.editorFieldId);
        onReorder?.(ids);
        onStatus?.("complete");
      } else {
        onStatus?.("cancelled");
      }
    };
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!current.ghost?.animate || reduceMotion) {
      complete();
      return;
    }
    current.ghost.animate([
      { transform: `translate3d(0, ${currentOffsetY}px, 0) scale(1.025)` },
      { transform: `translate3d(0, ${finalOffsetY}px, 0) scale(1)` }
    ], {
      duration: DROP_DURATION_MS,
      easing: "cubic-bezier(0.2, 0.75, 0.25, 1)",
      fill: "forwards"
    }).finished.then(complete, complete);
  };

  const pointerDown = (event) => {
    if (event.pointerType === "touch" || (event.pointerType === "mouse" && event.button !== 0)) return;
    startSession({ target: event.target, clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId });
  };
  const pointerMove = (event) => {
    if (!session || event.pointerId !== session.pointerId) return;
    updateSession(event.clientX, event.clientY, event);
  };
  const pointerUp = (event) => {
    if (!session || event.pointerId !== session.pointerId) return;
    finishSession();
  };
  const pointerCancel = (event) => {
    if (!session || event.pointerId !== session.pointerId) return;
    clearSession("cancelled");
  };
  const touchStart = (event) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    startSession({ target: event.target, clientX: touch.clientX, clientY: touch.clientY, touchIdentifier: touch.identifier });
  };
  const touchMove = (event) => {
    if (!session || session.touchIdentifier === null) return;
    const touch = [...event.touches].find((item) => item.identifier === session.touchIdentifier);
    if (!touch) return;
    updateSession(touch.clientX, touch.clientY, event);
  };
  const touchEnd = (event) => {
    if (!session || session.touchIdentifier === null) return;
    if (![...event.changedTouches].some((item) => item.identifier === session.touchIdentifier)) return;
    finishSession();
  };
  const touchCancel = () => {
    if (session && session.touchIdentifier !== null) clearSession("cancelled");
  };
  const contextMenu = (event) => {
    if (event.target.closest("[data-editor-field-id]")) event.preventDefault();
  };

  container.addEventListener("pointerdown", pointerDown);
  container.addEventListener("pointermove", pointerMove, { passive: false });
  container.addEventListener("pointerup", pointerUp);
  container.addEventListener("pointercancel", pointerCancel);
  container.addEventListener("touchstart", touchStart, { passive: true });
  container.addEventListener("touchmove", touchMove, { passive: false });
  container.addEventListener("touchend", touchEnd);
  container.addEventListener("touchcancel", touchCancel);
  container.addEventListener("contextmenu", contextMenu);

  return () => {
    clearSession();
    container.removeEventListener("pointerdown", pointerDown);
    container.removeEventListener("pointermove", pointerMove);
    container.removeEventListener("pointerup", pointerUp);
    container.removeEventListener("pointercancel", pointerCancel);
    container.removeEventListener("touchstart", touchStart);
    container.removeEventListener("touchmove", touchMove);
    container.removeEventListener("touchend", touchEnd);
    container.removeEventListener("touchcancel", touchCancel);
    container.removeEventListener("contextmenu", contextMenu);
  };
}
