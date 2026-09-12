const LONG_PRESS_MS = 420;
const MOVE_TOLERANCE = 9;
const EDGE_ZONE = 86;
const MAX_SCROLL_SPEED = 13;

export function bindLongPressReorder(container, { onReorder, onStatus } = {}) {
  if (!container) return () => {};
  let session = null;

  const clearSession = () => {
    if (!session) return;
    clearTimeout(session.timer);
    cancelAnimationFrame(session.scrollFrame);
    session.card?.classList.remove("reorder-active");
    session.card?.removeAttribute("aria-grabbed");
    session = null;
    document.body.classList.remove("question-reordering");
  };

  const autoScroll = () => {
    if (!session?.active) return;
    const height = window.innerHeight;
    let delta = 0;
    if (session.clientY < EDGE_ZONE) delta = -MAX_SCROLL_SPEED * (1 - session.clientY / EDGE_ZONE);
    if (session.clientY > height - EDGE_ZONE) delta = MAX_SCROLL_SPEED * (1 - (height - session.clientY) / EDGE_ZONE);
    if (delta) window.scrollBy(0, delta);
    session.scrollFrame = requestAnimationFrame(autoScroll);
  };

  const activate = () => {
    if (!session) return;
    session.active = true;
    session.card.classList.add("reorder-active");
    session.card.setAttribute("aria-grabbed", "true");
    document.body.classList.add("question-reordering");
    onStatus?.("active");
    session.scrollFrame = requestAnimationFrame(autoScroll);
  };

  const pointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const card = event.target.closest("[data-editor-field-id]");
    if (!card || event.target.closest("input, textarea, select, label, [data-no-reorder]")) return;
    clearSession();
    session = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      clientY: event.clientY,
      card,
      active: false,
      moved: false,
      scrollFrame: 0,
      timer: setTimeout(activate, LONG_PRESS_MS)
    };
  };

  const pointerMove = (event) => {
    if (!session || event.pointerId !== session.pointerId) return;
    session.clientY = event.clientY;
    const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
    if (!session.active && distance > MOVE_TOLERANCE) {
      clearSession();
      return;
    }
    if (!session.active) return;
    event.preventDefault();
    session.moved = true;
    const cards = [...container.querySelectorAll("[data-editor-field-id]")].filter((item) => item !== session.card);
    const target = cards.find((item) => event.clientY < item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2);
    if (target) container.insertBefore(session.card, target);
    else container.append(session.card);
  };

  const finish = (event) => {
    if (!session || event.pointerId !== session.pointerId) return;
    const wasActive = session.active;
    const moved = session.moved;
    const card = session.card;
    clearSession();
    if (!wasActive) return;
    card.dataset.suppressClick = "true";
    setTimeout(() => delete card.dataset.suppressClick, 0);
    const ids = [...container.querySelectorAll("[data-editor-field-id]")].map((item) => item.dataset.editorFieldId);
    onReorder?.(ids);
    onStatus?.(moved ? "complete" : "cancelled");
  };

  container.addEventListener("pointerdown", pointerDown);
  container.addEventListener("pointermove", pointerMove, { passive: false });
  container.addEventListener("pointerup", finish);
  container.addEventListener("pointercancel", clearSession);

  return () => {
    clearSession();
    container.removeEventListener("pointerdown", pointerDown);
    container.removeEventListener("pointermove", pointerMove);
    container.removeEventListener("pointerup", finish);
    container.removeEventListener("pointercancel", clearSession);
  };
}
